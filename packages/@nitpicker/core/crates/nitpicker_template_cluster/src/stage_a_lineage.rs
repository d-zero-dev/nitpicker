//! Which Stage A clusters a Stage B group pools.

/// One Stage A cluster pooled into a Stage B group: the Pass-0 block it came
/// from and how many pages it held. A group carries the entries of every
/// unit merged into it, so a later merge proposal can ask whether Stage A
/// already told the two sides apart (`are_stage_a_separated`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineageEntry {
	/// The block, as a number the run assigned: two entries are of one block
	/// exactly when the numbers are equal.
	pub block: u32,
	/// Pages the cluster held.
	pub page_count: usize,
}

/// The lineage of a not-yet-merged unit: one entry for the unit itself.
///
/// Every unit of a run knows its block, so there is no "no block
/// information" lineage; an empty lineage (which no merge is ever vetoed
/// on) only arises for a group missing from a context.
#[must_use]
pub fn initial_lineage(block: u32, member_count: usize) -> Vec<LineageEntry> {
	vec![LineageEntry {
		block,
		page_count: member_count,
	}]
}

#[cfg(test)]
mod tests {
	use super::{LineageEntry, initial_lineage};

	#[test]
	fn one_entry_with_the_block_and_the_member_count() {
		assert_eq!(
			initial_lineage(4, 3),
			vec![LineageEntry {
				block: 4,
				page_count: 3
			}]
		);
		assert_eq!(initial_lineage(0, 2)[0].page_count, 2);
	}
}
