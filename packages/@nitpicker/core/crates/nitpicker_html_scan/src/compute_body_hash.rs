use sha2::{Digest, Sha256};

use crate::extract_body::extract_body;
use crate::mask_dynamic_ids::mask_dynamic_ids;
use crate::normalize_url_like_strings::normalize_url_like_strings;

/// SHA-256 of a page's `<body>` after normalizing away incidental variance
/// (`/index.{ext}` URL forms, embedded dynamic ids) — the value persisted as
/// `page_meta.body_hash`.
///
/// Normalization runs before masking, in that order, because collapsing
/// `/index.html` to `/` must happen before the mask sees the text. The four
/// stages are kept as separate passes, one per JS oracle function in
/// `@nitpicker/archive`'s `src/body-hash/`, so a parity failure points at a
/// single stage; fusing them into one pass is tracked in issue #430.
#[must_use]
pub fn compute_body_hash(html: &[u8]) -> [u8; 32] {
	let body = extract_body(html);
	let normalized = normalize_url_like_strings(body);
	let masked = mask_dynamic_ids(&normalized);
	Sha256::digest(masked.as_ref()).into()
}

#[cfg(test)]
mod tests {
	use super::compute_body_hash;

	#[test]
	fn hashes_the_empty_input_as_sha256_of_nothing() {
		let expected = [
			0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14, 0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f,
			0xb9, 0x24, 0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c, 0xa4, 0x95, 0x99, 0x1b,
			0x78, 0x52, 0xb8, 0x55,
		];
		assert_eq!(compute_body_hash(b""), expected);
	}

	#[test]
	fn ignores_differences_in_dynamic_ids() {
		assert_eq!(
			compute_body_hash(b"<body><a href=\"/u/a1b2c3d4/\">p</a></body>"),
			compute_body_hash(b"<body><a href=\"/u/z9y8x7w6/\">p</a></body>")
		);
	}

	#[test]
	fn ignores_differences_in_index_suffix_notation() {
		assert_eq!(
			compute_body_hash(b"<body><a href=\"/about/index.html\">a</a></body>"),
			compute_body_hash(b"<body><a href=\"/about/\">a</a></body>")
		);
	}

	#[test]
	fn distinguishes_different_content() {
		assert_ne!(
			compute_body_hash(b"<body>Page A</body>"),
			compute_body_hash(b"<body>Page B</body>")
		);
	}

	#[test]
	fn ignores_everything_outside_body() {
		assert_eq!(
			compute_body_hash(b"<head><title>A</title></head><body>same</body>"),
			compute_body_hash(b"<head><title>B</title></head><body>same</body>")
		);
	}
}
