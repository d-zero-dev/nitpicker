//! Whether one landmark instance is shared chrome or content.

/// The share of an instance's tokens that must be shell tokens for it to
/// count as chrome. Matches the quorum and shell fractions used elsewhere in
/// Stage B by convention; unlike those it was not validated on real crawls
/// on its own.
pub const DEFAULT_CHROME_OVERLAP_THRESHOLD: f64 = 0.8;

/// Classifies one landmark instance as chrome (shared site or section
/// furniture) or content, from its own tokens and the shell token set
/// (`shell_quorum`) found for its group.
///
/// ## Why containment and not Jaccard
///
/// The shell is the union of chrome tokens over a whole group's landmark
/// instances, so it is usually far larger than any single instance.
/// Jaccard's denominator is the union of both sets, which stays shell-sized
/// even when the instance is entirely shell tokens, driving the score down
/// however purely "shell" the instance is. Containment —
/// `|instance ∩ shell| / |instance|` — asks the question that matters for
/// one instance: how many of its own tokens are shell.
///
/// An instance without tokens is never chrome: there is nothing to
/// corroborate. (Stage A drops such instances before Stage B sees them; this
/// is the defensive default.)
///
/// `shell_tokens` is ascending.
#[must_use]
pub fn is_chrome_landmark_instance(
	instance_tokens: &[u32],
	shell_tokens: &[u32],
	threshold: f64,
) -> bool {
	if instance_tokens.is_empty() {
		return false;
	}
	let hit = instance_tokens
		.iter()
		.filter(|token| shell_tokens.binary_search(token).is_ok())
		.count();
	// Counts stay far below 2^52; the conversions are exact.
	#[allow(clippy::cast_precision_loss)]
	let share = hit as f64 / instance_tokens.len() as f64;
	share >= threshold
}

#[cfg(test)]
mod tests {
	use super::{DEFAULT_CHROME_OVERLAP_THRESHOLD, is_chrome_landmark_instance};

	const DEFAULT: f64 = DEFAULT_CHROME_OVERLAP_THRESHOLD;

	#[test]
	fn an_instance_without_tokens_is_never_chrome() {
		assert!(!is_chrome_landmark_instance(&[], &[1, 2], DEFAULT));
	}

	#[test]
	fn an_instance_covered_by_the_shell_is_chrome() {
		assert!(is_chrome_landmark_instance(&[1, 2], &[1, 2, 3], DEFAULT));
	}

	#[test]
	fn an_instance_without_overlap_is_not_chrome() {
		assert!(!is_chrome_landmark_instance(&[8, 9], &[1, 2], DEFAULT));
	}

	#[test]
	fn an_instance_right_at_the_default_threshold_is_chrome() {
		// 4 of 5 tokens are shell: 0.8.
		assert!(is_chrome_landmark_instance(
			&[1, 2, 3, 4, 9],
			&[1, 2, 3, 4],
			DEFAULT
		));
	}

	#[test]
	fn an_instance_just_below_the_default_threshold_is_not_chrome() {
		// 3 of 4 tokens: 0.75.
		assert!(!is_chrome_landmark_instance(
			&[1, 2, 3, 9],
			&[1, 2, 3],
			DEFAULT
		));
	}

	#[test]
	fn a_custom_threshold_overrides_the_default() {
		assert!(is_chrome_landmark_instance(&[1, 9], &[1], 0.5));
		assert!(!is_chrome_landmark_instance(&[1, 9], &[1], 0.6));
	}

	#[test]
	fn the_default_threshold_is_point_eight() {
		assert_eq!(DEFAULT.to_bits(), 0.8_f64.to_bits());
	}
}
