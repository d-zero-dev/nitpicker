//! Reservoir sampling that keeps the input order: how Stage B cuts a merged
//! group back to its member cap.

use crate::seeded_random::SeededRandom;

/// The positions Algorithm R (Vitter, 1985) picks to keep `sample_size` of
/// `len` items, seeded from `seed` (a unit's cluster key), ascending — so the
/// kept items stay in input order and parallel arrays sampled at the same
/// positions stay parallel.
///
/// Deterministic for a given seed and length: the stored keys of an archive with a
/// sampled block depend on which members a merged group kept, so the sequence is
/// the stored one, number for number (`SeededRandom`).
///
/// A `sample_size` of 0 or an empty input keeps nothing; one at least `len`
/// keeps everything without drawing a number, so a group that fits its cap
/// is never reordered.
///
/// ```text
/// reservoir_sample_positions(10, 3, "[\"path:a\",\"cluster:0\"]")
/// // three ascending positions below 10, the same on every call
/// ```
#[must_use]
pub fn reservoir_sample_positions(len: usize, sample_size: usize, seed: &str) -> Vec<usize> {
	if sample_size == 0 || len == 0 {
		return Vec::new();
	}
	if sample_size >= len {
		return (0..len).collect();
	}
	let mut random = SeededRandom::from_key(seed);
	let mut reservoir: Vec<usize> = (0..sample_size).collect();
	for position in sample_size..len {
		// `floor(random * (position + 1))`, as JavaScript computes it; the
		// operands stay far below 2^52.
		#[allow(
			clippy::cast_possible_truncation,
			clippy::cast_sign_loss,
			clippy::cast_precision_loss
		)]
		let slot = (random.next_f64() * (position + 1) as f64).floor() as usize;
		if slot < sample_size {
			reservoir[slot] = position;
		}
	}
	reservoir.sort_unstable();
	reservoir
}

#[cfg(test)]
mod tests {
	use super::reservoir_sample_positions;
	use crate::seeded_random::SeededRandom;

	#[test]
	fn keeps_the_requested_number_of_positions() {
		assert_eq!(reservoir_sample_positions(100, 10, "seed").len(), 10);
	}

	#[test]
	fn is_deterministic_for_one_seed() {
		assert_eq!(
			reservoir_sample_positions(100, 10, "seed"),
			reservoir_sample_positions(100, 10, "seed")
		);
	}

	#[test]
	fn different_seeds_sample_differently_on_large_inputs() {
		assert_ne!(
			reservoir_sample_positions(100, 10, "block-a"),
			reservoir_sample_positions(100, 10, "block-b")
		);
	}

	#[test]
	fn returns_the_positions_ascending_and_distinct() {
		let positions = reservoir_sample_positions(100, 10, "seed");
		assert!(positions.windows(2).all(|pair| pair[0] < pair[1]));
		assert!(positions.iter().all(|&position| position < 100));
	}

	#[test]
	fn a_sample_size_of_at_least_the_length_keeps_everything_in_order() {
		assert_eq!(
			reservoir_sample_positions(4, 10, "ignored"),
			vec![0, 1, 2, 3]
		);
		assert_eq!(
			reservoir_sample_positions(4, 4, "ignored"),
			vec![0, 1, 2, 3]
		);
	}

	#[test]
	fn a_sample_size_of_zero_or_no_items_keeps_nothing() {
		assert_eq!(reservoir_sample_positions(3, 0, "x"), Vec::<usize>::new());
		assert_eq!(reservoir_sample_positions(0, 10, "x"), Vec::<usize>::new());
	}

	#[test]
	fn replays_the_algorithm_over_the_seeded_sequence() {
		// The same loop written out by hand over `SeededRandom`, the
		// sequence `fnv1a32` + `mulberry32` give in JavaScript.
		let mut random = SeededRandom::from_key("block-x");
		let mut expected: Vec<usize> = vec![0, 1, 2];
		for position in 3..20_u32 {
			let slot = (random.next_f64() * f64::from(position + 1)).floor();
			#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
			let slot = slot as usize;
			if slot < 3 {
				expected[slot] = position as usize;
			}
		}
		expected.sort_unstable();
		assert_eq!(reservoir_sample_positions(20, 3, "block-x"), expected);
	}
}
