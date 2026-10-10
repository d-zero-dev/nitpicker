use std::borrow::Cow;
use std::sync::LazyLock;

use regex::bytes::Regex;

/// ASCII alphanumeric runs of 8 or more. Unicode mode is off so `i` only
/// folds ASCII letters, as JS does without the `u` flag.
static DYNAMIC_ID_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
	Regex::new(r"(?i-u)[a-z0-9]{8,}").expect("DYNAMIC_ID_PATTERN is a valid regular expression")
});

const MASK_PLACEHOLDER: &[u8] = b"__MASKED_ID__";

/// Replaces mixed letter-and-digit tokens of 8+ characters with a fixed
/// placeholder, so bodies that differ only in an embedded dynamic value (a
/// cache-busting hash, a CSS-module suffix, a session or order id) hash the
/// same.
///
/// Pure-digit runs (phone numbers, dates) and pure-letter runs (ordinary
/// words) are left alone. This is a heuristic: a mixed SKU that is the only
/// difference between two pages is masked too, which is accepted because its
/// shape is indistinguishable from the cache-busting tokens this exists to
/// absorb. The placeholder is constant because nothing reverses the
/// substitution — the original HTML stays in `page_html_blobs`.
#[must_use]
pub fn mask_dynamic_ids(text: &[u8]) -> Cow<'_, [u8]> {
	let mut masked: Option<Vec<u8>> = None;
	let mut copied_up_to = 0;
	for token in DYNAMIC_ID_PATTERN.find_iter(text) {
		if !is_mixed_alphanumeric(token.as_bytes()) {
			continue;
		}
		let out = masked.get_or_insert_with(|| Vec::with_capacity(text.len()));
		out.extend_from_slice(&text[copied_up_to..token.start()]);
		out.extend_from_slice(MASK_PLACEHOLDER);
		copied_up_to = token.end();
	}
	match masked {
		None => Cow::Borrowed(text),
		Some(mut out) => {
			out.extend_from_slice(&text[copied_up_to..]);
			Cow::Owned(out)
		}
	}
}

/// Every byte of `token` is already an ASCII letter or digit (guaranteed by
/// the pattern), so "neither all digits nor all letters" means "has both".
fn is_mixed_alphanumeric(token: &[u8]) -> bool {
	token.iter().any(u8::is_ascii_digit) && token.iter().any(u8::is_ascii_alphabetic)
}

#[cfg(test)]
mod tests {
	use super::mask_dynamic_ids;

	#[test]
	fn masks_mixed_tokens_of_eight_or_more() {
		assert_eq!(
			mask_dynamic_ids(b"/user/a1b2c3d4/ ABC12345XYZ").as_ref(),
			b"/user/__MASKED_ID__/ __MASKED_ID__"
		);
	}

	#[test]
	fn keeps_short_pure_digit_and_pure_letter_tokens() {
		let text: &[u8] = b"a1b2c3d 20260101 internationalization";
		assert_eq!(mask_dynamic_ids(text).as_ref(), text);
	}

	#[test]
	fn splits_tokens_on_non_ascii_letters() {
		// JS without `u` does not treat U+017F (ſ) as `[a-z]` under `i`, so the
		// token before it is too short and only `1234efgh` is masked.
		assert_eq!(
			mask_dynamic_ids("abcd\u{17F}1234efgh".as_bytes()).as_ref(),
			"abcd\u{17F}__MASKED_ID__".as_bytes()
		);
	}
}
