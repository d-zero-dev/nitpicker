//! Reads start and end tags out of stored markup without building a tree.
//!
//! The stored HTML is serializer output (`page.content()`), so this reader
//! follows the interpretation rules `docs/query.md` states for
//! `match-selector`, not the HTML parsing algorithm:
//!
//! 1. A comment (`<!--` … `-->`), a CDATA section (`<![CDATA[` … `]]>`) and
//!    a declaration (`<!` … `>`) are skipped; one that never ends runs to the
//!    end of the document.
//! 2. A raw text element (`script`, `style`, `xmp`, `iframe`, `noembed`,
//!    `noframes`, `plaintext`, `noscript`) yields its start tag only: the
//!    content up to the `>` of the first `</name` followed by a space, `/` or
//!    `>` is consumed (`plaintext` never ends), and no end tag is reported.
//!    Only the name decides; namespaces are not looked at.
//! 3. A start tag is `<` and a letter, a name running to the first space, `/`
//!    or `>`, then attributes read as an HTML tokenizer reads them (see
//!    `start_tag_attributes`), up to the `>` that closes the tag: a `<` or `>`
//!    inside a quoted value is not markup. A `<` that does not begin such a
//!    tag — no closing `>`, an unterminated quote — is text. A void element,
//!    and a tag whose attribute text ends in `/`, has no children (`leaf`).
//!
//! Tag names are returned as they are written; callers compare them with
//! [`slice::eq_ignore_ascii_case`], because HTML's tag and attribute names
//! ignore ASCII case only.

use memchr::{memchr, memmem};

use crate::ascii::is_html_space;
use crate::start_tag_attributes::scan_start_tag_attributes;

/// A start or end tag read from the stored markup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TagEvent<'a> {
	/// A start tag.
	Open {
		/// The tag name as written.
		name: &'a [u8],
		/// Everything between the tag name and the closing `>`.
		attributes: &'a [u8],
		/// `true` when the element has no children in the tree: a void
		/// element, `<x/>`, or a raw text element (whose content was consumed).
		leaf: bool,
	},
	/// An end tag.
	Close {
		/// The tag name as written.
		name: &'a [u8],
	},
}

const RAW_TEXT_ELEMENTS: [&[u8]; 8] = [
	b"script",
	b"style",
	b"xmp",
	b"iframe",
	b"noembed",
	b"noframes",
	b"plaintext",
	b"noscript",
];

const VOID_ELEMENTS: [&[u8]; 18] = [
	b"area",
	b"base",
	b"basefont",
	b"bgsound",
	b"br",
	b"col",
	b"embed",
	b"frame",
	b"hr",
	b"img",
	b"input",
	b"keygen",
	b"link",
	b"meta",
	b"param",
	b"source",
	b"track",
	b"wbr",
];

fn is_in(list: &[&[u8]], name: &[u8]) -> bool {
	list.iter()
		.any(|candidate| candidate.eq_ignore_ascii_case(name))
}

/// Jumps from tag to tag through a document, never looking at the text in
/// between.
#[derive(Clone, Debug)]
pub struct TagTokenizer<'a> {
	html: &'a [u8],
	position: usize,
	/// Where the last `>` of the document is: a tag that starts after it can
	/// never be closed, so neither can any later one.
	last_close: Option<usize>,
}

impl<'a> TagTokenizer<'a> {
	/// Starts reading at the beginning of `html`.
	#[must_use]
	pub fn new(html: &'a [u8]) -> Self {
		Self {
			html,
			position: 0,
			last_close: html.iter().rposition(|&byte| byte == b'>'),
		}
	}

	/// The next tag, or `None` at the end of the document.
	pub fn next_event(&mut self) -> Option<TagEvent<'a>> {
		let html = self.html;
		loop {
			let Some(offset) = memchr(b'<', &html[self.position..]) else {
				self.position = html.len();
				return None;
			};
			let at = self.position + offset;
			// Every tag ends at a `>`. Past the last one nothing can be read, which also
			// keeps a run of `<a <b <c …` with no `>` from rescanning the rest of the
			// document for each opener.
			if self.last_close.is_none_or(|last| at > last) {
				self.position = html.len();
				return None;
			}
			match html.get(at + 1) {
				Some(b'!') => {
					self.position = skip_declaration(html, at);
				}
				Some(b'/') if html.get(at + 2).is_some_and(u8::is_ascii_alphabetic) => {
					let name_end = name_end(html, at + 2);
					if let Some(close) = memchr(b'>', &html[name_end..]) {
						self.position = name_end + close + 1;
						return Some(TagEvent::Close {
							name: &html[at + 2..name_end],
						});
					}
					self.position = at + 1;
				}
				Some(letter) if letter.is_ascii_alphabetic() => {
					let name_end = name_end(html, at + 1);
					if let Some(close) = find_tag_end(html, name_end) {
						let name = &html[at + 1..name_end];
						let attributes = &html[name_end..close];
						self.position = close + 1;
						if is_in(&RAW_TEXT_ELEMENTS, name) {
							self.position = skip_raw_text(html, name, self.position);
							return Some(TagEvent::Open {
								name,
								attributes,
								leaf: true,
							});
						}
						return Some(TagEvent::Open {
							name,
							attributes,
							leaf: is_in(&VOID_ELEMENTS, name) || attributes.ends_with(b"/"),
						});
					}
					self.position = at + 1;
				}
				_ => {
					self.position = at + 1;
				}
			}
		}
	}
}

/// The end of a tag name that starts at `from`: the first space, `/` or `>`.
fn name_end(html: &[u8], from: usize) -> usize {
	html[from..]
		.iter()
		.position(|&byte| is_html_space(byte) || byte == b'/' || byte == b'>')
		.map_or(html.len(), |offset| from + offset)
}

/// The position of the `>` that closes a start tag whose attribute text
/// begins at `from`, reading attributes as an HTML tokenizer does (a `>` in
/// a quoted value does not close the tag); `None` when the tag is never
/// closed.
fn find_tag_end(html: &[u8], from: usize) -> Option<usize> {
	scan_start_tag_attributes(html, from, |_| {})
}

/// Where reading resumes after the declaration that opens at `at` (a `<!`).
fn skip_declaration(html: &[u8], at: usize) -> usize {
	let (terminator, from): (&[u8], usize) = if html[at..].starts_with(b"<!--") {
		(b"-->", at + 4)
	} else if html[at..].starts_with(b"<![CDATA[") {
		(b"]]>", at + 9)
	} else {
		(b">", at + 2)
	};
	memmem::find(&html[from..], terminator)
		.map_or(html.len(), |offset| from + offset + terminator.len())
}

/// Where reading resumes after the content of the raw text element `name`
/// whose start tag ended just before `from`.
fn skip_raw_text(html: &[u8], name: &[u8], from: usize) -> usize {
	if name.eq_ignore_ascii_case(b"plaintext") {
		return html.len();
	}
	let mut index = from;
	while let Some(offset) = memchr(b'<', &html[index..]) {
		let at = index + offset;
		let name_at = at + 2;
		let name_to = name_at + name.len();
		if html.get(at + 1) == Some(&b'/')
			&& html
				.get(name_at..name_to)
				.is_some_and(|written| written.eq_ignore_ascii_case(name))
			&& html
				.get(name_to)
				.is_some_and(|&next| is_html_space(next) || next == b'/' || next == b'>')
		{
			return memchr(b'>', &html[name_to..]).map_or(html.len(), |close| name_to + close + 1);
		}
		index = at + 1;
	}
	html.len()
}

#[cfg(test)]
mod tests {
	use super::{TagEvent, TagTokenizer};

	fn events(html: &str) -> Vec<String> {
		let mut tokenizer = TagTokenizer::new(html.as_bytes());
		let mut out = Vec::new();
		while let Some(event) = tokenizer.next_event() {
			out.push(match event {
				TagEvent::Open {
					name,
					attributes,
					leaf,
				} => format!(
					"open {}{}[{}]",
					String::from_utf8_lossy(name),
					if leaf { "!" } else { "" },
					String::from_utf8_lossy(attributes)
				),
				TagEvent::Close { name } => format!("close {}", String::from_utf8_lossy(name)),
			});
		}
		out
	}

	#[test]
	fn reads_start_and_end_tags_in_order() {
		assert_eq!(
			events(r#"<p class="a">x<b>y</b></p>"#),
			["open p[ class=\"a\"]", "open b[]", "close b", "close p"]
		);
	}

	#[test]
	fn skips_comments_cdata_and_declarations() {
		assert_eq!(
			events("<!--<b>--><i><![CDATA[<u>]]><!doctype html><s>"),
			["open i[]", "open s[]"]
		);
	}

	#[test]
	fn a_comment_does_not_end_at_the_dashes_of_its_opener() {
		assert_eq!(events("<!--><b>-->"), Vec::<String>::new());
		assert_eq!(events("<!---><b>-->"), Vec::<String>::new());
	}

	#[test]
	fn an_unterminated_comment_runs_to_the_end() {
		assert_eq!(events("<a><!-- <b></b>"), ["open a[]"]);
	}

	#[test]
	fn a_raw_text_element_yields_only_its_start_tag() {
		assert_eq!(
			events(r#"<script src="a">if (a<b) { "</scr" + "ipt>"; }</script><i>"#),
			["open script![ src=\"a\"]", "open i[]"]
		);
	}

	#[test]
	fn a_raw_text_end_tag_matches_case_insensitively_and_needs_a_boundary() {
		assert_eq!(
			events("<style>a</styled><b></STYLE ><i>"),
			["open style![]", "open i[]"]
		);
	}

	#[test]
	fn an_unterminated_raw_text_element_runs_to_the_end() {
		assert_eq!(events("<script><b></b>"), ["open script![]"]);
		assert_eq!(events("<plaintext><b></plaintext>"), ["open plaintext![]"]);
	}

	#[test]
	fn a_raw_text_end_tag_without_a_closing_angle_bracket_runs_to_the_end() {
		assert_eq!(events("<script></script <b"), ["open script![]"]);
		// The first `>` after the end tag's name closes it, whatever it was part of.
		assert_eq!(
			events("<script></script <b><i>"),
			["open script![]", "open i[]"]
		);
	}

	#[test]
	fn void_elements_and_self_closed_tags_are_leaves() {
		assert_eq!(
			events("<br><IMG src=a><x/><y a=b/>"),
			[
				"open br![]",
				"open IMG![ src=a]",
				"open x![/]",
				"open y![ a=b/]"
			]
		);
	}

	#[test]
	fn a_less_than_sign_inside_a_quoted_value_is_not_a_tag() {
		assert_eq!(
			events(r#"<a title="<img>">x</a>"#),
			["open a[ title=\"<img>\"]", "close a"]
		);
	}

	#[test]
	fn a_greater_than_sign_inside_a_quoted_value_does_not_end_the_tag() {
		assert_eq!(
			events(r#"<a title="a>b" href="/">"#),
			["open a[ title=\"a>b\" href=\"/\"]"]
		);
	}

	#[test]
	fn a_tag_that_is_never_closed_is_text() {
		// The tag's quote never closes, so what follows is read afresh.
		assert_eq!(events("<a href=\"x><b>"), ["open b[]"]);
		assert_eq!(events("<a href=x"), Vec::<String>::new());
		assert_eq!(events("<a <b>"), ["open a[ <b]"]);
	}

	#[test]
	fn a_less_than_sign_before_a_non_letter_is_text() {
		assert_eq!(events("a < b <3 <b>"), ["open b[]"]);
	}

	#[test]
	fn an_end_tag_may_carry_anything_up_to_its_angle_bracket() {
		assert_eq!(events("</a  x=\"y\" ><b>"), ["close a", "open b[]"]);
	}

	#[test]
	fn a_quote_in_a_tag_name_is_part_of_the_name() {
		assert_eq!(events("<a\"b c>"), ["open a\"b[ c]"]);
	}

	#[test]
	fn reads_multibyte_text_between_tags() {
		assert_eq!(events("<p>日本語</p>"), ["open p[]", "close p"]);
	}

	#[test]
	fn every_raw_text_element_swallows_its_content_and_end_tag() {
		for name in [
			"script", "style", "xmp", "iframe", "noembed", "noframes", "noscript",
		] {
			assert_eq!(
				events(&format!("<{name} a=\"1\"><i></i></{name}><b>")),
				[format!("open {name}![ a=\"1\"]"), "open b[]".to_owned()],
				"{name}"
			);
		}
	}

	#[test]
	fn a_raw_text_element_does_not_end_at_another_end_tag_or_a_longer_name() {
		assert_eq!(
			events("<script>\"</i>\"</script><b>"),
			["open script![]", "open b[]"]
		);
		assert_eq!(
			events("<script>x</scripts>y</script><i>"),
			["open script![]", "open i[]"]
		);
		assert_eq!(
			events("<style>a</script>b</style><i>"),
			["open style![]", "open i[]"]
		);
	}

	#[test]
	fn a_raw_text_end_tag_accepts_whitespace_slash_and_any_case() {
		for end in ["</SCRIPT>", "</script >", "</script\n>", "</Script/>"] {
			assert_eq!(
				events(&format!("<script>x{end}<i>")),
				["open script![]", "open i[]"],
				"{end}"
			);
		}
	}

	#[test]
	fn a_doctype_and_text_that_only_looks_like_a_tag_are_skipped() {
		assert_eq!(events("<!DOCTYPE html><b>"), ["open b[]"]);
		assert_eq!(
			events("a < b and 1<2 &lt;i&gt; </ > <1>"),
			Vec::<String>::new()
		);
	}

	#[test]
	fn returns_a_template_and_what_is_inside_it_as_ordinary_tags() {
		assert_eq!(
			events("<template><i></i></template>"),
			["open template[]", "open i[]", "close i", "close template"]
		);
	}

	#[test]
	fn does_not_rescan_the_rest_of_the_document_for_every_unterminated_comment() {
		let html = "<!-- ".repeat(20_000) + &"x".repeat(1_000_000);
		let mut tokenizer = TagTokenizer::new(html.as_bytes());
		assert!(tokenizer.next_event().is_none());
	}

	#[test]
	fn does_not_rescan_the_rest_of_the_document_for_every_opener_that_is_never_closed() {
		let html = "<a ".repeat(200_000) + &"x".repeat(1_000_000);
		let mut tokenizer = TagTokenizer::new(html.as_bytes());
		assert!(tokenizer.next_event().is_none());
	}

	#[test]
	fn reads_the_tags_before_the_last_angle_bracket_and_ignores_the_openers_after_it() {
		assert_eq!(events("<a><b <c"), ["open a[]"]);
		assert_eq!(
			events("<a><b></b> <c <d"),
			["open a[]", "open b[]", "close b"]
		);
	}

	#[test]
	fn a_longer_name_is_not_a_raw_text_element() {
		assert_eq!(
			events("<scripts>x</scripts>"),
			["open scripts[]", "close scripts"]
		);
		assert_eq!(
			events("<SCRIPT>x</SCRIPT><i>"),
			["open SCRIPT![]", "open i[]"]
		);
	}

	#[test]
	fn a_quote_inside_an_attribute_name_does_not_hide_the_end_of_the_tag() {
		// What a browser writes after `content="…` lost its closing quote in the source.
		assert_eq!(
			events(r#"<meta name="d" content="a=" og:locale"=""><i>"#),
			[
				"open meta![ name=\"d\" content=\"a=\" og:locale\"=\"\"]",
				"open i[]"
			]
		);
	}
}
