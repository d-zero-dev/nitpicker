//! The grouping key of a page's stylesheet set.

use std::fmt::Write as _;

use indexmap::IndexSet;
use sha2::{Digest, Sha256};

use crate::js_string::{compare_utf16, json_string};

/// Hex characters kept of the SHA-256 digest: 64 bits tell stylesheet sets
/// apart with room to spare and keep block keys short. Part of every stored
/// `css:` block key, so it cannot change.
const HASH_LENGTH: usize = 16;

/// The key of the set of stylesheet URLs a page loads: pages with the exact
/// same set are near-certainly one template family. A strong but sparse
/// signal, since many pages load few or none.
///
/// The hrefs are compared as given, so they must already be comparable
/// across the corpus (absolute). Order and repeats do not matter: the
/// distinct hrefs are sorted by UTF-16 code units (JavaScript's default sort),
/// serialized as a JSON array (so no character inside one href can pass for
/// the boundary between two) and hashed with SHA-256, truncated to
/// `HASH_LENGTH` hex characters.
///
/// ```text
/// derive_stylesheet_group_key(["https://example.com/a.css", "https://example.com/b.css"])
///     == "9742767276316d59"
/// ```
#[must_use]
pub fn derive_stylesheet_group_key(stylesheet_hrefs: &[&str]) -> String {
	let mut sorted: Vec<&str> = stylesheet_hrefs
		.iter()
		.copied()
		.collect::<IndexSet<&str>>()
		.into_iter()
		.collect();
	sorted.sort_by(|a, b| compare_utf16(a, b));

	let quoted: Vec<String> = sorted.iter().map(|href| json_string(href)).collect();
	let json = format!("[{}]", quoted.join(","));

	let digest = Sha256::digest(json.as_bytes());
	let mut hex = String::with_capacity(HASH_LENGTH);
	for byte in &digest[..HASH_LENGTH / 2] {
		let _ = write!(hex, "{byte:02x}");
	}
	hex
}

#[cfg(test)]
mod tests {
	use super::derive_stylesheet_group_key;

	#[test]
	fn the_empty_set_has_a_pinned_key() {
		assert_eq!(derive_stylesheet_group_key(&[]), "4f53cda18c2baa0c");
	}

	#[test]
	fn a_two_href_set_hashes_to_a_pinned_key() {
		assert_eq!(
			derive_stylesheet_group_key(&[
				"https://example.com/a.css",
				"https://example.com/b.css"
			]),
			"9742767276316d59"
		);
	}

	#[test]
	fn a_single_href_hashes_to_a_pinned_key() {
		assert_eq!(
			derive_stylesheet_group_key(&["https://example.com/a.css"]),
			"ac39f3dbf4cdfdbf"
		);
	}

	#[test]
	fn is_independent_of_input_order() {
		assert_eq!(
			derive_stylesheet_group_key(&[
				"https://example.com/a.css",
				"https://example.com/b.css"
			]),
			derive_stylesheet_group_key(&[
				"https://example.com/b.css",
				"https://example.com/a.css"
			])
		);
	}

	#[test]
	fn different_sets_have_different_keys() {
		assert_ne!(
			derive_stylesheet_group_key(&["https://example.com/a.css"]),
			derive_stylesheet_group_key(&[
				"https://example.com/a.css",
				"https://example.com/b.css"
			])
		);
	}

	#[test]
	fn repeated_hrefs_do_not_change_the_key() {
		assert_eq!(
			derive_stylesheet_group_key(&[
				"https://example.com/a.css",
				"https://example.com/a.css",
				"https://example.com/b.css",
			]),
			derive_stylesheet_group_key(&[
				"https://example.com/a.css",
				"https://example.com/b.css"
			])
		);
	}

	#[test]
	fn one_href_containing_a_space_is_not_two_hrefs() {
		assert_ne!(
			derive_stylesheet_group_key(&[
				"https://example.com/a.css",
				"https://example.com/b.css"
			]),
			derive_stylesheet_group_key(&["https://example.com/a.css b.css"])
		);
	}

	#[test]
	fn sorts_by_utf16_code_units_not_utf8_bytes() {
		// U+1F600 (code units D83D DE00) sorts before U+FF61 in UTF-16 but
		// after it in UTF-8, so the two orders hash differently. The key is
		// the hash of the JSON array with the astral character first.
		assert_eq!(
			derive_stylesheet_group_key(&["\u{FF61}", "\u{1F600}"]),
			"95ff696c2aa54b03"
		);
		assert_eq!(
			derive_stylesheet_group_key(&["\u{1F600}", "\u{FF61}"]),
			"95ff696c2aa54b03"
		);
	}
}
