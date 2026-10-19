use sha2::{Digest, Sha256};

use crate::mask_dynamic_ids::MASK_PLACEHOLDER;
use crate::normalize_url_like_strings::INDEX_SUFFIX_PATTERN;

/// Shortest ASCII alphanumeric run `mask_dynamic_ids` masks.
const MIN_MASKED_RUN: usize = 8;

/// SHA-256 of `mask_dynamic_ids(normalize_url_like_strings(body))`, computed
/// in a single pass that feeds the hasher slices of `body` and the two
/// replacement strings, without building either intermediate buffer.
///
/// Fusing the stages is exact because normalizing never moves a masking
/// token boundary. A match of `/index\.\w+` starts with `/` and its greedy
/// `\w+` stops before a non-word byte (or the end), so both edges of the
/// match border a byte that is not ASCII alphanumeric — before and after
/// the `/` replacement alike. An alphanumeric run therefore never spans a
/// match, and masking each stretch between matches on its own sees the same
/// runs `mask_dynamic_ids` sees in the normalized text. The property test
/// `tests/fused_body_hash_properties.rs` checks this against the staged
/// functions.
#[must_use]
pub fn hash_normalized_masked(body: &[u8]) -> [u8; 32] {
	let mut hasher = Sha256::new();
	let mut stretch_start = 0;
	for suffix in INDEX_SUFFIX_PATTERN.find_iter(body) {
		update_masked(&mut hasher, &body[stretch_start..suffix.start()]);
		hasher.update(b"/");
		stretch_start = suffix.end();
	}
	update_masked(&mut hasher, &body[stretch_start..]);
	hasher.finalize().into()
}

/// Feeds `text` to `hasher` with every mixed letter-and-digit ASCII run of
/// [`MIN_MASKED_RUN`] or more bytes replaced by [`MASK_PLACEHOLDER`].
///
/// A hand-written scan rather than `mask_dynamic_ids`'s `[a-z0-9]{8,}`
/// search: under leftmost-first semantics that pattern matches exactly the
/// maximal runs of 8 or more, which a byte loop finds while also noting
/// whether a run mixes letters and digits, so no run is read twice.
fn update_masked(hasher: &mut Sha256, text: &[u8]) {
	let mut copied_up_to = 0;
	let mut run_start = 0;
	let mut has_digit = false;
	let mut has_letter = false;
	for (index, &byte) in text.iter().enumerate() {
		if byte.is_ascii_alphanumeric() {
			if !has_digit && !has_letter {
				run_start = index;
			}
			has_digit |= byte.is_ascii_digit();
			has_letter |= byte.is_ascii_alphabetic();
			continue;
		}
		if has_digit && has_letter && index - run_start >= MIN_MASKED_RUN {
			hasher.update(&text[copied_up_to..run_start]);
			hasher.update(MASK_PLACEHOLDER);
			copied_up_to = index;
		}
		has_digit = false;
		has_letter = false;
	}
	if has_digit && has_letter && text.len() - run_start >= MIN_MASKED_RUN {
		hasher.update(&text[copied_up_to..run_start]);
		hasher.update(MASK_PLACEHOLDER);
		copied_up_to = text.len();
	}
	hasher.update(&text[copied_up_to..]);
}

#[cfg(test)]
mod tests {
	use sha2::{Digest, Sha256};

	use super::hash_normalized_masked;

	fn sha256(bytes: &[u8]) -> [u8; 32] {
		Sha256::digest(bytes).into()
	}

	#[test]
	fn hashes_text_without_matches_as_is() {
		assert_eq!(hash_normalized_masked(b"plain text"), sha256(b"plain text"));
	}

	#[test]
	fn collapses_index_suffixes_and_masks_mixed_runs() {
		assert_eq!(
			hash_normalized_masked(b"/a/index.html x a1b2c3d4 y"),
			sha256(b"/a/ x __MASKED_ID__ y")
		);
	}

	#[test]
	fn masks_a_run_that_ends_the_text() {
		assert_eq!(
			hash_normalized_masked(b"id=ABC12345XYZ"),
			sha256(b"id=__MASKED_ID__")
		);
	}

	#[test]
	fn keeps_short_pure_digit_and_pure_letter_runs() {
		let text: &[u8] = b"a1b2c3d 20260101 internationalization";
		assert_eq!(hash_normalized_masked(text), sha256(text));
	}

	#[test]
	fn masks_a_run_right_after_an_index_suffix() {
		// `\w+` stops at `-`, so the run after it starts a new stretch.
		assert_eq!(
			hash_normalized_masked(b"/index.php-a1b2c3d4"),
			sha256(b"/-__MASKED_ID__")
		);
	}

	#[test]
	fn lets_the_index_suffix_swallow_a_trailing_run() {
		assert_eq!(
			hash_normalized_masked(b"/index.html1234abcd!"),
			sha256(b"/!")
		);
	}
}
