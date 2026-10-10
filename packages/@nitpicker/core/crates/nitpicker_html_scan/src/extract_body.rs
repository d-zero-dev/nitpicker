use std::sync::LazyLock;

use regex::bytes::Regex;

/// `<body` followed by an attribute-aware span up to the real closing `>`.
///
/// The span skips quoted values so a literal `>` inside one
/// (`<body data-x="a>b">`) does not end the tag early. Nothing requires a
/// tag-name boundary after `<body`, so `<bodyguard>` also matches — kept on
/// purpose because `page_meta.body_hash` values already persisted were
/// computed that way (see issue #434 before changing it).
const OPENING_TAG: &str = r#"<body(?:"[^"]*"|'[^']*'|[^"'>])*>"#;

const CLOSING_TAG: &str = "</body>";

/// The JS pattern `/<body(?:"[^"]*"|'[^']*'|[^"'>])*>([\s\S]*)<\/body>/i`
/// without its capture group: the greedy `(?s-u:.)*` runs to the last
/// `</body>`, and the regex engine keeps JS's leftmost-first choice of start
/// (including a retry that begins inside an earlier tag's attribute value,
/// `<body a="<body></body>">`).
static BODY_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
	Regex::new(&format!("(?i-u){OPENING_TAG}(?s-u:.)*{CLOSING_TAG}"))
		.expect("BODY_PATTERN is a valid regular expression")
});

static OPENING_TAG_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
	Regex::new(&format!("(?i-u){OPENING_TAG}"))
		.expect("OPENING_TAG_PATTERN is a valid regular expression")
});

/// Extracts the inner HTML of the first matching `<body>` element.
///
/// Uses two capture-free searches instead of reading the JS pattern's
/// capture group: the `regex` crate resolves captures with its slow engine
/// over the whole matched span — milliseconds per large page, on the
/// crawler's event loop — while a plain `find` runs on the fast DFA. The
/// whole-pattern match gives the start of `<body…>` and the end of the last
/// `</body>`; re-matching only the opening tag at that start gives where the
/// capture begins. That re-match ends where the whole-pattern match's tag
/// ended because an opening tag has a single possible end per start (a quote
/// can only be consumed by its quoted alternative and `>` ends the
/// repetition) — keep it that way if `OPENING_TAG` changes.
///
/// The result runs to the last `</body>`, so a literal `<body>` / `</body>`
/// inside the real body (an inline code sample) does not truncate it.
/// Returns `html` unchanged when no `<body>…</body>` pair is found
/// (fragments, half-rendered snapshots), so callers never need a not-found
/// branch.
///
/// # Panics
///
/// Never for any input: the opening-tag pattern is a prefix of the whole
/// pattern, so it always matches where the whole pattern matched. The
/// `expect` documents that invariant instead of hiding a violation behind a
/// silent fallback.
#[must_use]
pub fn extract_body(html: &[u8]) -> &[u8] {
	let Some(whole) = BODY_PATTERN.find(html) else {
		return html;
	};
	let opening = OPENING_TAG_PATTERN
		.find_at(html, whole.start())
		.expect("the opening tag matches where the whole pattern matched");
	&html[opening.end()..whole.end() - CLOSING_TAG.len()]
}

#[cfg(test)]
mod tests {
	use super::extract_body;

	#[test]
	fn returns_the_inner_html_of_body() {
		assert_eq!(
			extract_body(b"<html><body class=\"a\">hello</body></html>"),
			b"hello"
		);
	}

	#[test]
	fn skips_a_greater_than_sign_inside_a_quoted_attribute() {
		assert_eq!(extract_body(b"<body data-x=\"a>b\">in</body>"), b"in");
		assert_eq!(extract_body(b"<body data-x='a>b'>in</body>"), b"in");
	}

	#[test]
	fn runs_to_the_last_closing_body() {
		assert_eq!(extract_body(b"<body>a</body>b</body>c"), b"a</body>b");
	}

	#[test]
	fn retries_from_inside_an_opening_tag_whose_body_never_closes() {
		// The outer tag ends after the last `</body>`, so (like JS) the match
		// restarts one character later and finds the `<body>` inside its value.
		assert_eq!(extract_body(b"<body a=\"<body></body>\">tail"), b"");
	}

	#[test]
	fn keeps_the_outer_tag_when_a_later_closing_body_exists() {
		assert_eq!(
			extract_body(b"<body a=\"<body>x</body>\">tail</BODY>"),
			b"tail"
		);
	}

	#[test]
	fn matches_tags_case_insensitively() {
		assert_eq!(extract_body(b"<BODY>x</BoDy>"), b"x");
	}

	#[test]
	fn treats_bodyguard_as_body() {
		assert_eq!(extract_body(b"<bodyguard>g</body>"), b"g");
	}

	#[test]
	fn falls_back_to_the_whole_input_without_a_body_pair() {
		assert_eq!(extract_body(b"<div>fragment</div>"), b"<div>fragment</div>");
		assert_eq!(extract_body(b"<body>never closed"), b"<body>never closed");
	}

	#[test]
	fn does_not_fold_non_ascii_letters_into_the_tag_name() {
		// U+017F (ſ) upper-cases to `S`; JS without the `u` flag does not fold it.
		let html = "<bod\u{17F}y>no</body>".as_bytes();
		assert_eq!(extract_body(html), html);
	}
}
