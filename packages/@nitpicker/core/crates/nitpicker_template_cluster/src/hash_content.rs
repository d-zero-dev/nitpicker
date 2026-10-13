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
}
