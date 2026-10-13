use std::fmt::Write as _;

use sha2::{Digest, Sha256};

use crate::js_string::{is_js_whitespace, js_trim};

/// Hex characters kept of the SHA-256 digest: enough to tell "this
/// script / style / svg changed", short enough to keep tokens readable.
const HASH_LENGTH: usize = 16;

/// The `sha` of an opaque element (`script` / `style` / `noscript` / `svg`):
/// the first 16 hex characters of SHA-256 over its raw content, trimmed and
/// with whitespace runs collapsed to one space, so formatting alone does not
/// change it.
#[must_use]
pub fn hash_content(raw: &str) -> String {
	let mut normalized = String::with_capacity(raw.len());
	let mut in_whitespace = false;
	for c in js_trim(raw).chars() {
		if is_js_whitespace(c) {
			if !in_whitespace {
				normalized.push(' ');
				in_whitespace = true;
			}
		} else {
			normalized.push(c);
			in_whitespace = false;
		}
	}
	let digest = Sha256::digest(normalized.as_bytes());
	let mut hex = String::with_capacity(HASH_LENGTH);
	for byte in &digest[..HASH_LENGTH / 2] {
		let _ = write!(hex, "{byte:02x}");
	}
	hex
}

#[cfg(test)]
mod tests {
	use super::hash_content;

	#[test]
	fn hashes_the_normalized_content() {
		assert_eq!(hash_content("\n  a\t\u{3000}b  "), hash_content("a b"));
		assert_eq!(hash_content("a b").len(), 16);
		assert_ne!(hash_content("ab"), hash_content("a b"));
	}

	#[test]
	fn matches_the_javascript_digest_of_an_empty_string() {
		assert_eq!(hash_content(""), "e3b0c44298fc1c14");
	}

	#[test]
	fn returns_a_sixteen_character_lowercase_hex_digest() {
		let digest = hash_content("console.log(\"hi\")");
		assert_eq!(digest.len(), 16);
		assert!(
			digest
				.chars()
				.all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
		);
	}

	#[test]
	fn is_deterministic_for_identical_content() {
		assert_eq!(
			hash_content(".card { color: red; }"),
			hash_content(".card { color: red; }")
		);
	}

	#[test]
	fn does_not_unify_the_absence_of_whitespace_with_a_run_of_it() {
		assert_ne!(
			hash_content(".card{color:red}"),
			hash_content(".card{\n  color:   red\n}")
		);
	}

	#[test]
	fn ignores_indentation_and_line_breaks_alone() {
		assert_eq!(
			hash_content("function f() {\n  return 1;\n}"),
			hash_content("function f() { return 1; }")
		);
	}

	#[test]
	fn differs_for_different_content() {
		assert_ne!(hash_content("a"), hash_content("b"));
	}

	#[test]
	fn trims_leading_and_trailing_whitespace() {
		assert_eq!(hash_content("  hello  "), hash_content("hello"));
		assert_eq!(hash_content("hello"), "2cf24dba5fb0a30e");
	}

	#[test]
	fn collapses_whitespace_runs_including_newlines_to_one_space() {
		assert_eq!(
			hash_content("var\n\n  a  =\r\n1;"),
			hash_content("var a = 1;")
		);
	}

	#[test]
	fn does_not_merge_tokens_separated_by_a_single_space() {
		assert_ne!(hash_content("var a=1;"), hash_content("var a = 1;"));
		assert_eq!(hash_content("var a=1;"), hash_content("var  a=1;"));
	}
}
