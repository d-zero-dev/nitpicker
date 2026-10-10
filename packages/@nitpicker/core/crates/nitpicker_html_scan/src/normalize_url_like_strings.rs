use std::borrow::Cow;
use std::sync::LazyLock;

use regex::bytes::{NoExpand, Regex};

/// `/index.{ext}` anywhere in the text. `\w` is the ASCII word class
/// (`[0-9A-Za-z_]`) because Unicode mode is off — the same set JS `\w`
/// matches without the `u` flag.
static INDEX_SUFFIX_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
	Regex::new(r"(?i-u)/index\.\w+").expect("INDEX_SUFFIX_PATTERN is a valid regular expression")
});

/// Collapses every `/index.{ext}` suffix (`/index.html`, `/INDEX.php`, …) to a
/// bare `/`, so bodies that differ only in which equivalent URL form a
/// template rendered (`/about/` vs `/about/index.html`) hash the same.
///
/// A blanket sweep over the whole text rather than `href` / `src` values only:
/// the same variance shows up in breadcrumbs, "print this page" widgets and
/// JSON inside inline scripts. Borrows the input when nothing matches.
#[must_use]
pub fn normalize_url_like_strings(body: &[u8]) -> Cow<'_, [u8]> {
	INDEX_SUFFIX_PATTERN.replace_all(body, NoExpand(b"/"))
}

#[cfg(test)]
mod tests {
	use super::normalize_url_like_strings;

	#[test]
	fn collapses_index_suffixes_case_insensitively() {
		assert_eq!(
			normalize_url_like_strings(b"/about/index.html /INDEX.PHP?x=1").as_ref(),
			b"/about/ /?x=1"
		);
	}

	#[test]
	fn requires_at_least_one_word_character_after_the_dot() {
		assert_eq!(
			normalize_url_like_strings(b"/index./ /index").as_ref(),
			b"/index./ /index"
		);
	}

	#[test]
	fn treats_only_ascii_as_word_characters() {
		// U+212A (Kelvin sign) folds to `k` in Unicode mode; JS without `u` does not.
		let text = "/index.\u{212A}".as_bytes();
		assert_eq!(normalize_url_like_strings(text).as_ref(), text);
	}
}
