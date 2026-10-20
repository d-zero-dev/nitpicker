//! Reads the attributes of a start tag the way an HTML tokenizer does.
//!
//! The stored markup is what a browser's serializer wrote: `name="value"`
//! pairs whose values escape `&`, `"` and U+00A0 (and, in newer browsers,
//! `<` and `>`). Attribute *names* are written as they are, so a page whose
//! source had junk in a name — `<meta property=" og:locale"="">` after
//! `content="…` lost its closing quote — comes back with a `"` inside a
//! name. Reading the text by pairing quotes would then lose track of where
//! the tag ends; reading it with the tokenizer's own rules (a name runs to
//! whitespace, `/`, `>` or `=`; a value is `"…"`, `'…'` or runs to
//! whitespace or `>`) recovers exactly the attributes the browser had.

use memchr::memchr;

use crate::ascii::is_html_space;

/// One attribute as written in a start tag; the value is not decoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StartTagAttribute<'a> {
	/// The attribute name as written.
	pub name: &'a [u8],
	/// The value between its quotes, or as written when unquoted; empty for
	/// a value-less attribute.
	pub value: &'a [u8],
}

fn skip_spaces(bytes: &[u8], mut at: usize) -> usize {
	while at < bytes.len() && is_html_space(bytes[at]) {
		at += 1;
	}
	at
}

/// Walks the attributes of a start tag whose attribute text begins at
/// `from`, calling `on_attribute` for each in source order, and returns the
/// position of the `>` that closes the tag; `None` when the tag is never
/// closed (the text ends first, or inside a quoted value).
///
/// A name starts at any byte that is not whitespace, `/` or `>` (a leading
/// `=` is part of the name) and runs to whitespace, `/`, `>` or `=`. After
/// it, optional whitespace, `=`, optional whitespace and a value: `"…"`,
/// `'…'`, or unquoted up to whitespace or `>`. An `=` with nothing before the
/// `>` leaves the value empty. A name that occurs twice is reported twice.
pub fn scan_start_tag_attributes<'a>(
	bytes: &'a [u8],
	from: usize,
	mut on_attribute: impl FnMut(StartTagAttribute<'a>),
) -> Option<usize> {
	let mut index = from;
	loop {
		while index < bytes.len() && (is_html_space(bytes[index]) || bytes[index] == b'/') {
			index += 1;
		}
		if bytes.get(index)? == &b'>' {
			return Some(index);
		}
		let name_start = index;
		index += 1;
		while index < bytes.len()
			&& !(is_html_space(bytes[index]) || matches!(bytes[index], b'/' | b'>' | b'='))
		{
			index += 1;
		}
		let name = &bytes[name_start..index];

		let equals = skip_spaces(bytes, index);
		if bytes.get(equals) != Some(&b'=') {
			on_attribute(StartTagAttribute { name, value: &[] });
			continue;
		}
		let value_start = skip_spaces(bytes, equals + 1);
		let value: &[u8] = match bytes.get(value_start)? {
			b'>' => {
				index = value_start;
				&[]
			}
			quote @ (b'"' | b'\'') => {
				let close = memchr(*quote, &bytes[value_start + 1..])?;
				index = value_start + close + 2;
				&bytes[value_start + 1..value_start + 1 + close]
			}
			_ => {
				let end = bytes[value_start..]
					.iter()
					.position(|&byte| is_html_space(byte) || byte == b'>')
					.map_or(bytes.len(), |offset| value_start + offset);
				index = end;
				&bytes[value_start..end]
			}
		};
		on_attribute(StartTagAttribute { name, value });
	}
}

/// Reads the attributes out of the text between a tag name and the closing
/// `>`, in source order, appending them to `out` (cleared first). See
/// [`scan_start_tag_attributes`] for the rules; a name that occurs twice
/// appears twice, and callers take the first, as an HTML parser does.
pub fn read_start_tag_attributes<'a>(source: &'a [u8], out: &mut Vec<StartTagAttribute<'a>>) {
	out.clear();
	scan_start_tag_attributes(source, 0, |attribute| out.push(attribute));
}

#[cfg(test)]
mod tests {
	use super::{StartTagAttribute, read_start_tag_attributes, scan_start_tag_attributes};

	fn read(source: &str) -> Vec<(String, String)> {
		let mut out: Vec<StartTagAttribute> = Vec::new();
		read_start_tag_attributes(source.as_bytes(), &mut out);
		out.iter()
			.map(|attribute| {
				(
					String::from_utf8_lossy(attribute.name).into_owned(),
					String::from_utf8_lossy(attribute.value).into_owned(),
				)
			})
			.collect()
	}

	fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
		list.iter()
			.map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
			.collect()
	}

	/// The tag's closing `>` found in `text` from `from`.
	fn tag_end(text: &str, from: usize) -> Option<usize> {
		scan_start_tag_attributes(text.as_bytes(), from, |_| {})
	}

	#[test]
	fn reads_quoted_unquoted_and_valueless_attributes() {
		assert_eq!(
			read(r#" class="a b" id='x' data-n=3 hidden>"#),
			pairs(&[
				("class", "a b"),
				("id", "x"),
				("data-n", "3"),
				("hidden", "")
			])
		);
	}

	#[test]
	fn allows_whitespace_around_the_equals_sign() {
		assert_eq!(
			read("  a \t=\n \"1\" b = 2>"),
			pairs(&[("a", "1"), ("b", "2")])
		);
	}

	#[test]
	fn keeps_a_repeated_name_in_source_order() {
		assert_eq!(read(r#" a="1" a="2">"#), pairs(&[("a", "1"), ("a", "2")]));
	}

	#[test]
	fn an_equals_sign_with_nothing_after_it_leaves_the_value_empty() {
		assert_eq!(read(" a=>"), pairs(&[("a", "")]));
		assert_eq!(read(" a= b=1>"), pairs(&[("a", "b=1")]));
	}

	#[test]
	fn reads_an_empty_quoted_value() {
		assert_eq!(read(r#" alt="">"#), pairs(&[("alt", "")]));
	}

	#[test]
	fn skips_stray_slashes() {
		assert_eq!(read(r#" / a="1" / b>"#), pairs(&[("a", "1"), ("b", "")]));
	}

	#[test]
	fn text_that_looks_like_an_attribute_inside_a_value_is_not_one() {
		assert_eq!(
			read(r#" title=" x=&quot;v&quot;">"#),
			pairs(&[("title", " x=&quot;v&quot;")])
		);
		assert_eq!(read(r#" title="a x=v">"#), pairs(&[("title", "a x=v")]));
		assert_eq!(
			read(r#" title="a > b" x="1">"#),
			pairs(&[("title", "a > b"), ("x", "1")])
		);
	}

	#[test]
	fn a_quote_inside_a_name_is_part_of_the_name() {
		// What a browser serializes after `content="…` lost its closing quote in the source.
		assert_eq!(
			read(r#" name="description" content="Example.&gt;&lt;meta property=" og:locale"="">"#),
			pairs(&[
				("name", "description"),
				("content", "Example.&gt;&lt;meta property="),
				("og:locale\"", ""),
			])
		);
	}

	#[test]
	fn a_leading_equals_sign_is_part_of_the_name() {
		assert_eq!(read(" =a=1>"), pairs(&[("=a", "1")]));
	}

	#[test]
	fn a_name_that_only_ends_in_the_wanted_name_is_another_attribute() {
		assert_eq!(read(r#" data-x="1">"#), pairs(&[("data-x", "1")]));
	}

	#[test]
	fn finds_the_closing_angle_bracket_past_quoted_ones() {
		assert_eq!(tag_end(r#" a="x>y" b>"#, 0), Some(10));
		assert_eq!(tag_end(r#" title="<img>">z"#, 0), Some(14));
	}

	#[test]
	fn a_tag_that_is_never_closed_has_no_end() {
		assert_eq!(tag_end(" href=x", 0), None);
		assert_eq!(tag_end(r#" href="x>"#, 0), None);
		assert_eq!(tag_end(" a=", 0), None);
		assert_eq!(tag_end("", 0), None);
	}
}
