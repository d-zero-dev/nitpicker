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
/// lowest active index — the exact choices of the JavaScript implementation
/// the stored keys came from, since a different tie-break can produce a
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

// Exact float comparisons on purpose: the port must reproduce the
// JavaScript values bit for bit, not approximately.
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
}
