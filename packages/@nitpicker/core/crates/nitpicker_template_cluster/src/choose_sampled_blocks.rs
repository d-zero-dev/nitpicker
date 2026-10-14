//! Which blocks a run clusters from a sample instead of whole.
//!
//! Two limits decide it, each bounding a different memory: Stage A's
//! similarity table (per block, `n * (n - 1) / 2 * 8` bytes) and the pages
//! held until the blocks clustered whole are processed (all of them at once,
//! about 60 KB a page). The table limit is the caller's budget. The page
//! limit is fixed at [`EXACT_PAGE_LIMIT`] and bounds only the held pages;
//! the table of a block is bounded by the budget alone.

use crate::run::BLOCK_SAMPLE_SIZE;

/// Pages of blocks clustered whole a run holds at once, at most. A corpus
/// whose blocks clustered whole would hold more has its largest blocks
/// sampled until it fits (a sampled block still holds its
/// [`crate::BLOCK_SAMPLE_SIZE`] sampled pages). Which blocks are sampled
/// decides their stored keys, so changing it reclassifies the archives it
/// moves.
pub const EXACT_PAGE_LIMIT: usize = 20_000;

/// Why a block is clustered from a sample.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SampleReason {
	/// Its similarity table would exceed the memory budget.
	TableOverBudget,
	/// The blocks clustered whole would hold more than [`EXACT_PAGE_LIMIT`]
	/// pages, and this one is among the largest.
	PagesOverLimit,
}

/// Bytes Stage A's similarity table takes for a block of `page_count` pages
/// (saturating).
#[must_use]
pub fn pair_bytes(page_count: usize) -> u64 {
	let n = page_count as u64;
	(n.saturating_mul(n.saturating_sub(1)) / 2).saturating_mul(8)
}

/// Decides, per block, whether it is clustered from a sample and why.
///
/// A block whose table exceeds `budget` bytes is sampled (a budget of 0
/// samples every block, even those with an empty table, which keeps such a
/// run identical to one that samples all). If the blocks left would still
/// hold more than [`EXACT_PAGE_LIMIT`] pages, the largest of them — most
/// pages first, ties to the block that appears first — are sampled until
/// they fit: the fewest blocks change, and the order is reproducible.
/// Sampling a block frees all its pages but the sample, so a block of at
/// most [`BLOCK_SAMPLE_SIZE`] pages frees nothing and is never chosen for
/// the limit; if the rest still exceeds it, it is held as it is.
///
/// `page_counts` is each block's pages, in block order; the result has one
/// entry per block, `None` for a block clustered whole.
#[must_use]
pub fn choose_sampled_blocks(page_counts: &[usize], budget: u64) -> Vec<Option<SampleReason>> {
	let mut chosen: Vec<Option<SampleReason>> = page_counts
		.iter()
		.map(|&page_count| {
			(budget == 0 || pair_bytes(page_count) > budget)
				.then_some(SampleReason::TableOverBudget)
		})
		.collect();

	let mut held: usize = page_counts
		.iter()
		.zip(&chosen)
		.filter(|(_, reason)| reason.is_none())
		.map(|(&page_count, _)| page_count)
		.sum();
	if held > EXACT_PAGE_LIMIT {
		let mut whole: Vec<usize> = (0..page_counts.len())
			.filter(|&block| chosen[block].is_none() && page_counts[block] > BLOCK_SAMPLE_SIZE)
			.collect();
		// Most pages first; `sort_by` is stable, so ties keep block order.
		whole.sort_by(|&a, &b| page_counts[b].cmp(&page_counts[a]));
		for block in whole {
			if held <= EXACT_PAGE_LIMIT {
				break;
			}
			chosen[block] = Some(SampleReason::PagesOverLimit);
			held -= page_counts[block] - BLOCK_SAMPLE_SIZE;
		}
	}
	chosen
}

#[cfg(test)]
mod tests {
	use super::{
		BLOCK_SAMPLE_SIZE, EXACT_PAGE_LIMIT, SampleReason, choose_sampled_blocks, pair_bytes,
	};

	const OVER: Option<SampleReason> = Some(SampleReason::TableOverBudget);
	const LIMIT: Option<SampleReason> = Some(SampleReason::PagesOverLimit);

	#[test]
	fn a_table_takes_eight_bytes_per_pair_of_pages() {
		assert_eq!(pair_bytes(0), 0);
		assert_eq!(pair_bytes(1), 0);
		assert_eq!(pair_bytes(2), 8);
		assert_eq!(pair_bytes(1000), 3_996_000);
		assert_eq!(pair_bytes(usize::MAX), u64::MAX);
	}

	#[test]
	fn samples_only_the_blocks_whose_table_exceeds_the_budget() {
		// 101 pages take 40,400 bytes: a budget of exactly that holds them.
		assert_eq!(choose_sampled_blocks(&[101, 50], 40_400), vec![None, None]);
		assert_eq!(choose_sampled_blocks(&[101, 50], 40_399), vec![OVER, None]);
	}

	#[test]
	fn a_zero_budget_samples_every_block() {
		assert_eq!(choose_sampled_blocks(&[1, 101], 0), vec![OVER, OVER]);
	}

	#[test]
	fn keeps_every_block_whole_up_to_the_page_limit() {
		let blocks = [EXACT_PAGE_LIMIT / 2, EXACT_PAGE_LIMIT / 2];
		assert_eq!(choose_sampled_blocks(&blocks, u64::MAX), vec![None, None]);
	}

	#[test]
	fn samples_the_largest_blocks_first_when_the_pages_exceed_the_limit() {
		// 5,000 + 12,000 + 8,000 = 25,000 pages: dropping the largest (12,000)
		// leaves 13,000, which fits.
		assert_eq!(
			choose_sampled_blocks(&[5_000, 12_000, 8_000], u64::MAX),
			vec![None, LIMIT, None]
		);
	}

	#[test]
	fn keeps_sampling_until_the_remaining_pages_fit() {
		// 15,000 + 15,000 + 100: the first sampled leaves 15,100 (fits).
		// 11,000 x 3: one leaves 22,000 (too many), two leave 11,000.
		assert_eq!(
			choose_sampled_blocks(&[11_000, 11_000, 11_000], u64::MAX),
			vec![LIMIT, LIMIT, None]
		);
	}

	#[test]
	fn blocks_no_larger_than_a_sample_are_never_chosen_for_the_page_limit() {
		// 250 blocks of 100 pages hold 25,000 pages, but sampling a block of
		// 100 pages frees none of them.
		assert_eq!(
			choose_sampled_blocks(&[BLOCK_SAMPLE_SIZE; 250], u64::MAX),
			vec![None; 250]
		);
	}

	#[test]
	fn sampling_frees_only_the_pages_beyond_the_sample() {
		// 200 blocks of 101 pages hold 20,200 pages. Sampling one frees 1
		// page (101 - 100), leaving 20,199; 200 pages must go, so the first
		// 200 blocks in order would all have to be sampled — and still hold
		// 200 * 100 = 20,000 pages.
		let chosen = choose_sampled_blocks(&[BLOCK_SAMPLE_SIZE + 1; 200], u64::MAX);
		assert_eq!(chosen.iter().filter(|reason| reason.is_some()).count(), 200);
	}

	#[test]
	fn breaks_ties_to_the_block_that_appears_first() {
		assert_eq!(
			choose_sampled_blocks(&[11_000, 11_000], u64::MAX),
			vec![LIMIT, None]
		);
	}

	#[test]
	fn pages_of_blocks_over_the_budget_do_not_count_toward_the_limit() {
		// The 30,000-page block is over the budget (3.6 GB > 1 GiB); the rest
		// (19,000 pages) fits the limit, so nothing else is sampled.
		assert_eq!(
			choose_sampled_blocks(&[30_000, 9_000, 10_000], 1024 * 1024 * 1024),
			vec![OVER, None, None]
		);
	}

	#[test]
	fn a_block_over_both_limits_is_reported_for_its_table() {
		assert_eq!(
			choose_sampled_blocks(&[30_000, 100], 1024 * 1024 * 1024),
			vec![OVER, None]
		);
	}
}
