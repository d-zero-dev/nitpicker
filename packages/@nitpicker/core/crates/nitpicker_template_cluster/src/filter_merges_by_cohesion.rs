//! The cohesion guard on Stage B's merge proposals.

use indexmap::IndexMap;

use crate::quorum_core::strict_quorum_core_size;

/// Minimum ratio a proposed merge's post-merge quorum-core size must retain
/// relative to the strongest lineage anchor on either side, or the merge is
/// discarded.
///
/// It has to sit between two edges: above about 0.3, so a hub unit does not
/// absorb several mutually unrelated units via containment (the hub's own
/// 10-token core collapses to the 3 tokens an absorbed unit also carries);
/// at or below about 0.8, so every genuine per-mirror unit of one template
/// (the same template once per axis value) keeps merging despite a handful
/// of per-page module drops. 0.7 sits inside that range with margin rather
/// than against an edge.
///
/// It is a per-step ratio, not an absolute floor. A long chain of
/// originally small-core units merged one step at a time can each clear the
/// ratio against the previous step's already-small anchor, so a long enough
/// chain of naturally low-information pages can still end up merged; the
/// guard reduces how often and how far, it does not make it impossible.
pub const MIN_COHESION_RATIO: f64 = 0.7;

/// The members' shaped distinctive token sets as slices.
fn slices(members: &[Vec<u32>]) -> Vec<&[u32]> {
	members.iter().map(Vec::as_slice).collect()
}

/// Filters a round's proposed `(absorbed, root)` merges, refusing any whose
/// post-merge quorum core would collapse relative to the best core any
/// single original unit now pooled into either side ever had — the guard
/// against Stage B's fine and L2 stages successively absorbing unrelated
/// units into a catch-all whose core shrinks toward shell-only tokens with
/// every merge. Each merge can look locally justified (the pair's pre-merge
/// cores still overlap enough to clear the thresholds) while the post-merge
/// core keeps shrinking, which no pre-merge check observes.
///
/// ## Why an anchor, not just the previous step
///
/// Comparing each merge only to the pool as it stood after the previous
/// accepted merge lets a long chain erode a core to nothing one acceptable
/// step at a time: each step dilutes the pool a little, and the reference
/// the ratio is measured against shrinks right along with it. `anchors`
/// carries every original unit's own pre-merge core size forward (by `max`,
/// never re-derived from the current pool), so every later attempt is
/// measured against the strongest evidence its lineage ever had.
///
/// Merges proposed for the same root are applied incrementally in the order
/// given, each checked against the pool after the previously accepted merges
/// for that root. The result is grouped by root, in the order each root first
/// appears in the proposals.
///
/// A merge whose post-merge core size is 0 is always rejected, even when the
/// anchor was also 0 (`0 >= ratio * 0` would pass vacuously): a unit that
/// already lost its core would otherwise become a sink absorbing anything.
/// `strict_quorum_core_size` is used, not the quorum core's size: its
/// fallback to the union would invert the signal for the merges this guard
/// exists to catch.
///
/// `distinctive_shaped` is indexed by group; its members are the class-
/// stripped projection of the distinctive tokens (shape ids), because the
/// fine stage's shape-Jaccard step pairs units with disjoint raw tokens by
/// construction and a check on raw tokens would reject all of them.
/// `anchors` is mutated: an accepted merge's root takes the larger of the two
/// anchors and the absorbed group's is cleared.
#[must_use]
pub fn filter_merges_by_cohesion(
	proposed_merges: &[(usize, usize)],
	distinctive_shaped: &[Vec<Vec<u32>>],
	anchors: &mut [Option<usize>],
) -> Vec<(usize, usize)> {
	let mut by_root: IndexMap<usize, Vec<usize>> = IndexMap::new();
	for &(absorbed, root) in proposed_merges {
		by_root.entry(root).or_default().push(absorbed);
	}

	let mut accepted = Vec::new();
	for (&root, absorbed_groups) in &by_root {
		let mut pooled: Vec<&[u32]> = slices(&distinctive_shaped[root]);
		for &absorbed in absorbed_groups {
			let absorbed_members = slices(&distinctive_shaped[absorbed]);
			let mut candidate_pool = pooled.clone();
			candidate_pool.extend_from_slice(&absorbed_members);
			let candidate_core_size = strict_quorum_core_size(&candidate_pool);
			let root_anchor = anchors[root].unwrap_or_else(|| strict_quorum_core_size(&pooled));
			let absorbed_anchor =
				anchors[absorbed].unwrap_or_else(|| strict_quorum_core_size(&absorbed_members));
			let reference_core_size = root_anchor.max(absorbed_anchor);

			// Core sizes stay far below 2^52; the conversions are exact.
			#[allow(clippy::cast_precision_loss)]
			let clears_ratio = candidate_core_size as f64 >= MIN_COHESION_RATIO * reference_core_size as f64;
			if candidate_core_size > 0 && clears_ratio {
				pooled = candidate_pool;
				anchors[root] = Some(reference_core_size);
				anchors[absorbed] = None;
				accepted.push((absorbed, root));
			}
		}
	}
	accepted
}

#[cfg(test)]
mod tests {
	use super::filter_merges_by_cohesion;

	/// `count` identical members listing `tokens`.
	fn members(count: usize, tokens: &[u32]) -> Vec<Vec<u32>> {
		vec![tokens.to_vec(); count]
	}

	#[test]
	fn accepts_a_merge_that_keeps_the_core() {
		let distinctive = vec![members(4, &[1, 2, 3]), members(4, &[1, 2, 3])];
		let mut anchors = vec![Some(3), Some(3)];
		assert_eq!(
			filter_merges_by_cohesion(&[(1, 0)], &distinctive, &mut anchors),
			vec![(1, 0)]
		);
		assert_eq!(anchors, vec![Some(3), None]);
	}

	#[test]
	fn rejects_a_merge_whose_core_collapses_below_the_ratio_of_the_anchor() {
		// A hub with a 10-token core against a unit sharing only 3 of them:
		// the pooled core keeps 3 < 0.7 * 10.
		let hub: Vec<u32> = (0..10).collect();
		let small: Vec<u32> = vec![0, 1, 2];
		let distinctive = vec![members(4, &hub), members(4, &small)];
		let mut anchors = vec![Some(10), Some(3)];
		assert_eq!(
			filter_merges_by_cohesion(&[(1, 0)], &distinctive, &mut anchors),
			vec![]
		);
		assert_eq!(anchors, vec![Some(10), Some(3)]);
	}

	#[test]
	fn rejects_a_merge_with_an_empty_post_merge_core_even_against_a_zero_anchor() {
		// One member each, disjoint tokens: no token reaches ceil(0.8 * 2) = 2.
		let distinctive = vec![members(1, &[1]), members(1, &[2])];
		let mut anchors = vec![Some(0), Some(0)];
		assert_eq!(
			filter_merges_by_cohesion(&[(1, 0)], &distinctive, &mut anchors),
			vec![]
		);
	}

	#[test]
	fn a_ratio_exactly_at_the_minimum_is_accepted() {
		// Reference 10, candidate 7: 7 >= 0.7 * 10 holds in floating point
		// (0.7 * 10 is exactly 7).
		let root: Vec<u32> = (0..7).collect();
		let absorbed: Vec<u32> = (0..7).collect();
		let distinctive = vec![members(2, &root), members(2, &absorbed)];
		let mut anchors = vec![Some(10), Some(4)];
		assert_eq!(
			filter_merges_by_cohesion(&[(1, 0)], &distinctive, &mut anchors),
			vec![(1, 0)]
		);
		assert_eq!(anchors[0], Some(10));
	}

	#[test]
	fn applies_the_merges_of_one_root_incrementally() {
		// Absorbing `1` is fine; absorbing `2` as well would dilute the pool
		// below the ratio of the anchor, which the first merge already
		// carried.
		let a: Vec<u32> = (0..10).collect();
		let b: Vec<u32> = (0..10).collect();
		let c: Vec<u32> = (0..3).collect();
		let distinctive = vec![members(4, &a), members(4, &b), members(4, &c)];
		let mut anchors = vec![Some(10), Some(10), Some(3)];
		assert_eq!(
			filter_merges_by_cohesion(&[(1, 0), (2, 0)], &distinctive, &mut anchors),
			vec![(1, 0)]
		);
	}

	#[test]
	fn groups_the_accepted_merges_by_root_in_first_proposal_order() {
		let same = vec![1, 2, 3];
		let distinctive = vec![
			members(2, &same),
			members(2, &same),
			members(2, &same),
			members(2, &same),
		];
		let mut anchors = vec![Some(3); 4];
		// Proposals interleave roots 0 and 2; the result lists root 0's first.
		assert_eq!(
			filter_merges_by_cohesion(&[(1, 0), (3, 2), (2, 0)], &distinctive, &mut anchors),
			vec![(1, 0), (2, 0), (3, 2)]
		);
	}
}
