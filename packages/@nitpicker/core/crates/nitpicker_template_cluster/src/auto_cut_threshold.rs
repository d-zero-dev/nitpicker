/// The midpoint of the widest gap between adjacent `heights` (in any
/// order), capped at `upper_bound` — so it only ever loosens the caller's
/// default, never tightens it. Fewer than two heights, or no gap at all,
/// leave `upper_bound`.
#[must_use]
pub fn auto_cut_threshold(heights: &[f64], upper_bound: f64) -> f64 {
	if heights.len() < 2 {
		return upper_bound;
	}
	let mut sorted = heights.to_vec();
	sorted.sort_by(|a, b| b.total_cmp(a));

	let mut max_gap = 0.0;
	let mut gap_index = 0;
	for index in 0..sorted.len() - 1 {
		let gap = sorted[index] - sorted[index + 1];
		if gap > max_gap {
			max_gap = gap;
			gap_index = index;
		}
	}
	if max_gap == 0.0 {
		return upper_bound;
	}
	// `(a + b) / 2` as JavaScript computes it (`f64::midpoint` agrees on
	// these magnitudes, but the plain form states the intent).
	#[allow(clippy::manual_midpoint)]
	let midpoint = (sorted[gap_index] + sorted[gap_index + 1]) / 2.0;
	midpoint.min(upper_bound)
}

// Exact float comparisons on purpose: the port must reproduce the
// JavaScript values bit for bit, not approximately.
#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
	use super::auto_cut_threshold;

	#[test]
	fn cuts_mid_gap_and_never_above_the_bound() {
		assert_eq!(auto_cut_threshold(&[1.0, 0.95, 0.3, 0.2], 0.8), 0.625);
		assert_eq!(auto_cut_threshold(&[1.0, 0.99, 0.98], 0.8), 0.8);
		assert_eq!(auto_cut_threshold(&[0.5], 0.8), 0.8);
		assert_eq!(auto_cut_threshold(&[0.5, 0.5], 0.8), 0.8);
	}
}
