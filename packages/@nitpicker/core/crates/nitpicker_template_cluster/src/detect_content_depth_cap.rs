use rustc_hash::FxHashSet;

use crate::complete_linkage_dendrogram::{complete_linkage_dendrogram, labels_at_threshold};
use crate::derive_comparison_sets::derive_comparison_sets;

/// The content-root depths tried, ascending.
///
/// Starts at 2: depth 1 keeps a handful of tokens per page, so list and
/// detail pages read as the same template (measured on a ~1,800-page crawl
/// without `<main>`: 48 clusters at depth 1 against 50 from 2; starting at
/// 3, or requiring a 2× jump, fragmented one section's freeform pages). The
/// cost: a block whose freeform content starts at depth 2 shows no knee and
/// stays uncapped.
pub const CANDIDATE_DEPTHS: [usize; 7] = [2, 3, 4, 5, 6, 8, 10];

/// The cluster-count ratio between consecutive depths that counts as the
/// knee: a 50 % jump.
const MIN_KNEE_RATIO: f64 = 1.5;

/// The similarity at which the sweep counts clusters.
const SWEEP_SIMILARITY_THRESHOLD: f64 = 0.8;

/// How many clusters `sets` (one ascending id list per page) form at the
/// sweep's fixed threshold.
fn cluster_count(sets: &[Vec<u32>]) -> usize {
	if sets.is_empty() {
		return 0;
	}
	let comparison = derive_comparison_sets(sets);
	let merges = complete_linkage_dendrogram(&comparison);
	labels_at_threshold(comparison.len(), &merges, SWEEP_SIMILARITY_THRESHOLD)
		.into_iter()
		.collect::<FxHashSet<usize>>()
		.len()
}

/// Picks the content-depth cap of a block from its pages' token sets at
/// each of [`CANDIDATE_DEPTHS`] (`sets_by_depth[d][page]`).
///
/// The cluster count stays flat while the cap keeps only template skeleton
/// and jumps once it lets freeform editorial content in (14× and 9× on two
/// unrelated crawls, both at depth 3). The depth just before the largest
/// jump of at least [`MIN_KNEE_RATIO`] is returned; with no such jump the
/// deepest candidate is (no cap rather than a guess). Depths are counted one
/// after another rather than in parallel: each holds an `n²/2` similarity
/// table (itself filled in parallel), the largest allocation of the run.
#[must_use]
pub fn detect_content_depth_cap(sets_by_depth: &[Vec<Vec<u32>>]) -> usize {
	let counts: Vec<usize> = sets_by_depth
		.iter()
		.map(|sets| cluster_count(sets))
		.collect();

	let mut best_ratio = f64::NEG_INFINITY;
	let mut knee: Option<usize> = None;
	for index in 1..counts.len() {
		let (previous, current) = (counts[index - 1], counts[index]);
		if previous == 0 {
			continue;
		}
		// Cluster counts stay far below 2^52; the conversions are exact.
		#[allow(clippy::cast_precision_loss)]
		let ratio = current as f64 / previous as f64;
		if ratio >= MIN_KNEE_RATIO && ratio > best_ratio {
			best_ratio = ratio;
			knee = Some(index);
		}
	}
	match knee {
		Some(index) => CANDIDATE_DEPTHS[index - 1],
		None => CANDIDATE_DEPTHS[CANDIDATE_DEPTHS.len() - 1],
	}
}

#[cfg(test)]
mod tests {
	use super::detect_content_depth_cap;

	fn distinct(pages: usize, offset: u32) -> Vec<Vec<u32>> {
		(0..pages)
			.map(|page| vec![1, offset + u32::try_from(page).unwrap()])
			.collect()
	}

	#[test]
	fn returns_the_depth_before_the_biggest_jump() {
		let same: Vec<Vec<u32>> = (0..4).map(|_| vec![1, 2]).collect();
		let sets = vec![
			same.clone(),
			same.clone(),
			distinct(4, 100),
			distinct(4, 200),
			distinct(4, 300),
			distinct(4, 400),
			distinct(4, 500),
		];
		assert_eq!(detect_content_depth_cap(&sets), 3);
	}

	#[test]
	fn returns_the_deepest_candidate_without_a_knee() {
		let same: Vec<Vec<u32>> = (0..4).map(|_| vec![1, 2]).collect();
		assert_eq!(detect_content_depth_cap(&vec![same; 7]), 10);
	}
}
