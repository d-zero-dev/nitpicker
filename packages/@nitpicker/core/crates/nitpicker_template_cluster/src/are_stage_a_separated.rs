//! Whether Stage A already told two Stage B groups apart.

use crate::stage_a_lineage::LineageEntry;

/// How many pages each of two Stage A clusters must hold for Stage A's
/// decision to keep them apart to count as evidence they are different
/// templates. Below this, "Stage A left them in separate clusters" only
/// means each is a leftover with content unlike the rest — a single page of
/// a freeform template is always its own cluster, and treating that as a
/// verdict would forbid exactly the merges Stage B exists for (dozens of
/// one-page units of the same template that differ only in their freeform
/// body). With several pages per side the block's quorum makes each side's
/// shared structure stable, so the split reflects structure, not page noise.
pub const STAGE_A_SEPARATION_MIN_PAGES: usize = 3;

/// Whether Stage A already told the two groups apart with real evidence:
/// some unit pooled into `a` and some unit pooled into `b` came from the
/// same Pass-0 block, were compared there on block-local comparison sets,
/// ended up as different clusters, and each held at least
/// [`STAGE_A_SEPARATION_MIN_PAGES`] pages.
///
/// Why the block-local verdict is worth keeping: Stage B compares cores
/// whose "distinctive" tokens are derived against the whole corpus, so
/// structure common to one block (a list page's and a detail page's shared
/// wrapper) but rare corpus-wide stays in both cores and dominates their
/// overlap. Stage A judged the same pair against the block's own
/// frequencies and separated it.
///
/// Why not derive the shell from a pair-local or block-local frequency split
/// inside Stage B instead: pair-local, every token shared by two singletons
/// is "present in all pages", so all of it — template included — would
/// count as shell, and an imbalanced pair (6 pages against 63) classes the
/// big side's stable tokens as shell too; block-local, a homogeneous
/// block's own template tokens are shell, which reproduces the
/// over-splitting Stage B exists to undo.
#[must_use]
pub fn are_stage_a_separated(a: &[LineageEntry], b: &[LineageEntry]) -> bool {
	a.iter().any(|left| {
		left.page_count >= STAGE_A_SEPARATION_MIN_PAGES
			&& b.iter().any(|right| {
				right.block == left.block && right.page_count >= STAGE_A_SEPARATION_MIN_PAGES
			})
	})
}

#[cfg(test)]
mod tests {
	use super::{STAGE_A_SEPARATION_MIN_PAGES, are_stage_a_separated};
	use crate::stage_a_lineage::LineageEntry;

	fn entry(block: u32, page_count: usize) -> LineageEntry {
		LineageEntry { block, page_count }
	}

	#[test]
	fn separates_two_big_clusters_of_one_block_only() {
		// Blocks: 0 is `path:news`, 1 is `path:about`.
		assert!(are_stage_a_separated(&[entry(0, 31)], &[entry(0, 165)]));
		// Single pages carry no evidence.
		assert!(!are_stage_a_separated(&[entry(0, 1)], &[entry(0, 1)]));
		// Never compared by Stage A.
		assert!(!are_stage_a_separated(&[entry(0, 31)], &[entry(1, 165)]));
	}

	#[test]
	fn the_page_count_floor_is_exactly_the_minimum_on_both_sides() {
		assert_eq!(STAGE_A_SEPARATION_MIN_PAGES, 3);
		let at = entry(7, 3);
		let below = entry(7, 2);
		assert!(are_stage_a_separated(&[at], &[at]));
		assert!(!are_stage_a_separated(&[at], &[below]));
		assert!(!are_stage_a_separated(&[below], &[at]));
	}

	#[test]
	fn one_qualifying_pair_anywhere_in_the_two_lineages_is_enough() {
		assert!(are_stage_a_separated(
			&[entry(10, 1), entry(7, 5)],
			&[entry(11, 9), entry(7, 4)]
		));
	}

	#[test]
	fn an_empty_lineage_is_never_a_separation() {
		assert!(!are_stage_a_separated(&[], &[entry(7, 9)]));
		assert!(!are_stage_a_separated(&[entry(7, 9)], &[]));
		assert!(!are_stage_a_separated(&[], &[]));
	}
}
