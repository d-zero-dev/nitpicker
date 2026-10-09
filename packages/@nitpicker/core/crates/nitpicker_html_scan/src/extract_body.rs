use std::sync::LazyLock;

use regex::bytes::Regex;

/// `<body` followed by an attribute-aware span up to the real closing `>`,
/// then a greedy capture up to the last `</body>`.
///
/// The attribute span skips quoted values so a literal `>` inside one
/// (`<body data-x="a>b">`) does not end the tag early. Nothing requires a
/// tag-name boundary after `<body`, so `<bodyguard>` also matches — kept on
/// purpose because `page_meta.body_hash` values already persisted were
/// computed that way (see issue #434 before changing it).
static BODY_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
	Regex::new(r#"(?i-u)<body(?:"[^"]*"|'[^']*'|[^"'>])*>((?s-u:.)*)</body>"#)
		.expect("BODY_PATTERN is a valid regular expression")
});

/// Extracts the inner HTML of the first matching `<body>` element.
///
/// The capture is greedy, so a literal `<body>` / `</body>` inside the real
/// body (an inline code sample) does not truncate the result: it always runs
/// to the last `</body>`. Returns `html` unchanged when no `<body>…</body>`
/// pair is found (fragments, half-rendered snapshots), so callers never need
/// a not-found branch.
#[must_use]
pub fn extract_body(html: &[u8]) -> &[u8] {
	BODY_PATTERN
		.captures(html)
		.and_then(|captures| captures.get(1))
		.map_or(html, |body| body.as_bytes())
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
