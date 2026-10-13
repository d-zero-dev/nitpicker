use rayon::prelude::*;

use crate::jaccard::jaccard;

/// One merge of the dendrogram: `survivor` (the lower index) absorbs `dead`
/// at Jaccard similarity `height`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Merge {
	/// Kept index.
	pub survivor: usize,
	/// Deactivated index.
	pub dead: usize,
	/// Similarity at which they merged.
	pub height: f64,
}

/// Tolerance for a merge height that floating-point division lands a hair
/// below a threshold it mathematically meets.
const BOUNDARY_EPSILON: f64 = 1e-9;

/// The pairwise similarities of `n` items, upper triangle only (the matrix
/// is symmetric and the diagonal is never read): half the memory of a full
/// `n × n` table, which for the largest blocks is most of the run's peak.
struct Similarities {
	n: usize,
	values: Vec<f64>,
}

impl Similarities {
	fn row_start(n: usize, i: usize) -> usize {
		i * n - i * (i + 1) / 2
	}

	fn index(&self, i: usize, j: usize) -> usize {
		let (low, high) = if i < j { (i, j) } else { (j, i) };
		Self::row_start(self.n, low) + (high - low - 1)
	}

	fn get(&self, i: usize, j: usize) -> f64 {
		self.values[self.index(i, j)]
	}

	fn set(&mut self, i: usize, j: usize, value: f64) {
		let index = self.index(i, j);
		self.values[index] = value;
	}

	fn compute(sets: &[Vec<u32>]) -> Self {
		let n = sets.len();
		let mut values = vec![0.0; n * (n - 1) / 2];
		let mut rows: Vec<(usize, &mut [f64])> = Vec::with_capacity(n);
		let mut rest = values.as_mut_slice();
		for i in 0..n {
			let (row, tail) = rest.split_at_mut(n - i - 1);
			rows.push((i, row));
			rest = tail;
		}
		rows.into_par_iter().for_each(|(i, row)| {
			for (offset, slot) in row.iter_mut().enumerate() {
				*slot = jaccard(&sets[i], &sets[i + 1 + offset]);
			}
		});
		Self { n, values }
	}
}

/// The complete-linkage dendrogram of `sets` (ascending id lists) by the
/// NN-chain algorithm (Murtagh 1983): all `n - 1` merges in discovery
/// order, so a caller can pick the cut from the full height sequence.
///
/// Ties go to the lowest candidate index and the chain restarts at the
/// lowest active index — the choices the stored keys were computed with
/// (the golden records pin them), since a different tie-break can produce a
/// different (equally valid) dendrogram.
#[must_use]
pub fn complete_linkage_dendrogram(sets: &[Vec<u32>]) -> Vec<Merge> {
	let size = sets.len();
	if size <= 1 {
		return Vec::new();
	}
	let mut similarity = Similarities::compute(sets);
	let mut active = vec![true; size];
	let mut chain: Vec<usize> = Vec::new();
	let mut merges = Vec::with_capacity(size - 1);
	let mut active_count = size;

	while active_count > 1 {
		if chain.is_empty() {
			let start = active
				.iter()
				.position(|&is_active| is_active)
				.expect("an active item is left");
			chain.push(start);
		}
		let top = *chain.last().expect("the chain is not empty");
		let mut best = usize::MAX;
		let mut best_score = f64::NEG_INFINITY;
		for (candidate, &is_active) in active.iter().enumerate() {
			if candidate != top && is_active {
				let score = similarity.get(top, candidate);
				if score > best_score {
					best_score = score;
					best = candidate;
				}
			}
		}

		let second_from_top = chain.len().checked_sub(2).map(|index| chain[index]);
		if Some(best) == second_from_top {
			chain.pop();
			chain.pop();
			let survivor = top.min(best);
			let dead = top.max(best);
			for (candidate, &is_active) in active.iter().enumerate() {
				if candidate != top && candidate != best && is_active {
					let linkage = similarity
						.get(top, candidate)
						.min(similarity.get(best, candidate));
					similarity.set(survivor, candidate, linkage);
				}
			}
			active[dead] = false;
			merges.push(Merge {
				survivor,
				dead,
				height: best_score,
			});
			active_count -= 1;
		} else {
			chain.push(best);
		}
	}
	merges
}

fn find(parent: &mut [usize], index: usize) -> usize {
	let mut root = index;
	while parent[root] != root {
		root = parent[root];
	}
	let mut current = index;
	while current != root {
		let next = parent[current];
		parent[current] = root;
		current = next;
	}
	root
}

/// Each item's cluster representative when the dendrogram is cut at
/// `threshold` (merges at or above it, within [`BOUNDARY_EPSILON`], apply;
/// Lance–Williams monotonicity makes the discovery order irrelevant).
#[must_use]
pub fn labels_at_threshold(size: usize, merges: &[Merge], threshold: f64) -> Vec<usize> {
	let mut parent: Vec<usize> = (0..size).collect();
	for merge in merges {
		if merge.height >= threshold - BOUNDARY_EPSILON {
			let dead_root = find(&mut parent, merge.dead);
			let survivor_root = find(&mut parent, merge.survivor);
			parent[dead_root] = survivor_root;
		}
	}
	(0..size).map(|index| find(&mut parent, index)).collect()
}

// Exact float comparisons on purpose: the stored keys depend on these
// values bit for bit, not approximately.
#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
	use super::{complete_linkage_dendrogram, labels_at_threshold};

	#[test]
	fn merges_identical_sets_first_and_cuts_at_the_threshold() {
		let sets = vec![vec![1, 2, 3], vec![1, 2, 3], vec![7, 8], vec![1, 2, 4]];
		let merges = complete_linkage_dendrogram(&sets);
		assert_eq!(merges.len(), 3);
		assert_eq!(
			(merges[0].survivor, merges[0].dead, merges[0].height),
			(0, 1, 1.0)
		);
		let labels = labels_at_threshold(4, &merges, 0.5);
		assert_eq!(labels[0], labels[1]);
		assert_eq!(labels[0], labels[3]);
		assert_ne!(labels[0], labels[2]);
		let strict = labels_at_threshold(4, &merges, 0.9);
		assert_ne!(strict[0], strict[3]);
	}

	#[test]
	fn uses_complete_linkage_heights() {
		// {0,1} merge at 1; the 0.5-similar item joins at the minimum of its
		// similarities to both, not the maximum.
		let sets = vec![vec![1, 2], vec![1, 2], vec![1, 3]];
		let merges = complete_linkage_dendrogram(&sets);
		assert_eq!(merges.last().unwrap().height, 1.0 / 3.0);
	}

	#[test]
	fn handles_trivial_inputs() {
		assert!(complete_linkage_dendrogram(&[]).is_empty());
		assert!(complete_linkage_dendrogram(&[vec![1]]).is_empty());
		assert_eq!(labels_at_threshold(1, &[], 0.8), vec![0]);
	}

	#[test]
	fn merges_two_identical_sets_at_height_one() {
		let merges = complete_linkage_dendrogram(&[vec![1, 2], vec![1, 2]]);
		assert_eq!(merges.len(), 1);
		assert_eq!(merges[0].height, 1.0);
	}

	#[test]
	fn merges_two_disjoint_sets_at_height_zero() {
		let merges = complete_linkage_dendrogram(&[vec![1], vec![2]]);
		assert_eq!(merges.len(), 1);
		assert_eq!(merges[0].height, 0.0);
	}

	#[test]
	fn produces_one_fewer_merge_than_items() {
		let sets: Vec<Vec<u32>> = (0..5).map(|page| vec![100 + page]).collect();
		assert_eq!(complete_linkage_dendrogram(&sets).len(), 4);
	}

	#[test]
	fn always_lets_the_lower_index_survive() {
		let merges = complete_linkage_dendrogram(&[vec![1, 2], vec![2, 3], vec![3, 4]]);
		for merge in &merges {
			assert!(merge.survivor < merge.dead);
		}
	}

	#[test]
	fn keeps_every_merge_height_within_zero_and_one() {
		let merges = complete_linkage_dendrogram(&[vec![1, 2, 3], vec![1, 2], vec![7, 8]]);
		for merge in &merges {
			assert!((0.0..=1.0).contains(&merge.height));
		}
	}

	#[test]
	fn merges_a_high_similarity_pair_before_a_low_similarity_one() {
		let merges = complete_linkage_dendrogram(&[vec![1, 2], vec![1, 2], vec![7, 8]]);
		assert_eq!(merges[0].height, 1.0);
		assert_eq!(merges[1].height, 0.0);
	}

	#[test]
	fn leaves_every_item_a_singleton_without_merges() {
		assert_eq!(labels_at_threshold(3, &[], 0.8), vec![0, 1, 2]);
	}

	#[test]
	fn joins_everything_at_threshold_zero() {
		let merges = complete_linkage_dendrogram(&[vec![1], vec![2], vec![3]]);
		let labels = labels_at_threshold(3, &merges, 0.0);
		assert_eq!(labels[0], labels[1]);
		assert_eq!(labels[1], labels[2]);
	}

	#[test]
	fn keeps_every_item_alone_above_all_heights() {
		// Every set is disjoint from the others, so every height is 0 < 1.
		let merges = complete_linkage_dendrogram(&[vec![1], vec![2], vec![3]]);
		let labels = labels_at_threshold(3, &merges, 1.0);
		assert_ne!(labels[0], labels[1]);
		assert_ne!(labels[1], labels[2]);
		assert_ne!(labels[0], labels[2]);
	}

	#[test]
	fn merges_identical_items_and_keeps_a_disjoint_one_apart_at_zero_point_eight() {
		let merges = complete_linkage_dendrogram(&[vec![1, 2], vec![1, 2], vec![3, 4]]);
		let labels = labels_at_threshold(3, &merges, 0.8);
		assert_eq!(labels[0], labels[1]);
		assert_ne!(labels[0], labels[2]);
	}

	#[test]
	fn returns_one_label_per_item() {
		let merges = complete_linkage_dendrogram(&[vec![1], vec![2]]);
		assert_eq!(labels_at_threshold(2, &merges, 0.5).len(), 2);
	}
}
