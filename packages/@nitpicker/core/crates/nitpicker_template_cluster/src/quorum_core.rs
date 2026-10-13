//! The frequency-quorum core of a group of pages.

use rustc_hash::FxHashMap;

/// A token must be present in at least this fraction of a group's pages to
/// enter the group's core.
///
/// Strict intersection degenerates: a group of 89 articles sharing only one
/// common distinctive token has similarity 1 with everything (seen on real
/// crawls). The full union is shell-dominated: 298 pages collapsed into 4
/// clusters (also seen). 80% avoids both failure modes.
pub const QUORUM_FRACTION: f64 = 0.8;

/// The page count a token must reach: `ceil(0.8 * n)`, computed in floating
/// point as JavaScript does (`0.8 * 5` is exactly `4`, `0.8 * 10` is exactly
/// `8`).
fn min_count(member_count: usize) -> f64 {
	// Member counts stay far below 2^52, so the conversion is exact.
	#[allow(clippy::cast_precision_loss)]
	let count = member_count as f64;
	(QUORUM_FRACTION * count).ceil()
}

/// How many of `members` carry each token. Each member lists distinct tokens.
fn token_counts(members: &[&[u32]]) -> FxHashMap<u32, u32> {
	let mut counts: FxHashMap<u32, u32> = FxHashMap::default();
	for tokens in members {
		for &token in *tokens {
			*counts.entry(token).or_insert(0) += 1;
		}
	}
	counts
}

/// The tokens present in at least `ceil(0.8 * n)` of the `n` `members`
/// (ascending ids, a set). When none clears that bar — a very small group —
/// the union of every member's tokens instead, so the core of a non-empty
/// group is never empty.
///
/// `members` each list distinct tokens.
///
/// ```text
/// compute_quorum_core([[1, 2], [1, 3], [1, 4]]) == [1]
/// compute_quorum_core([[1], [2]]) == [1, 2]   // nothing reaches ceil(0.8 * 2) = 2
/// ```
#[must_use]
pub fn compute_quorum_core(members: &[&[u32]]) -> Vec<u32> {
	if members.is_empty() {
		return Vec::new();
	}
	let minimum = min_count(members.len());
	let counts = token_counts(members);
	let mut core: Vec<u32> = counts
		.iter()
		.filter(|&(_, &count)| f64::from(count) >= minimum)
		.map(|(&token, _)| token)
		.collect();
	if core.is_empty() {
		core = counts.keys().copied().collect();
	}
	core.sort_unstable();
	core
}

/// How many tokens [`compute_quorum_core`] would keep without its
/// full-union fallback.
///
/// The fallback exists so a reported core is never empty for a tiny group,
/// but it makes the core's size useless as a cohesion signal: a merge that
/// destroys every token's quorum would read as "the core is now the size of
/// the union", bigger rather than smaller. The cohesion check needs "no
/// token survives the quorum" to mean zero.
#[must_use]
pub fn strict_quorum_core_size(members: &[&[u32]]) -> usize {
	if members.is_empty() {
		return 0;
	}
	let minimum = min_count(members.len());
	token_counts(members)
		.values()
		.filter(|&&count| f64::from(count) >= minimum)
		.count()
}

#[cfg(test)]
mod tests {
	use super::{compute_quorum_core, strict_quorum_core_size};

	#[test]
	fn an_empty_group_has_an_empty_core() {
		assert_eq!(compute_quorum_core(&[]), Vec::<u32>::new());
		assert_eq!(strict_quorum_core_size(&[]), 0);
	}

	#[test]
	fn keeps_the_tokens_of_at_least_eighty_percent_of_the_members() {
		// Five members: ceil(0.8 * 5) = 4 of them.
		let members: Vec<Vec<u32>> = vec![
			vec![1, 2],
			vec![1, 2],
			vec![1, 2],
			vec![1, 2, 3],
			vec![1, 4],
		];
		let slices: Vec<&[u32]> = members.iter().map(Vec::as_slice).collect();
		assert_eq!(compute_quorum_core(&slices), vec![1, 2]);
		assert_eq!(strict_quorum_core_size(&slices), 2);
	}

	#[test]
	fn drops_a_token_one_member_short_of_the_quorum() {
		// Ten members: ceil(0.8 * 10) = 8; token 2 is on 7.
		let members: Vec<Vec<u32>> = (0..10)
			.map(|index| if index < 7 { vec![1, 2] } else { vec![1] })
			.collect();
		let slices: Vec<&[u32]> = members.iter().map(Vec::as_slice).collect();
		assert_eq!(compute_quorum_core(&slices), vec![1]);
		let at_quorum: Vec<Vec<u32>> = (0..10)
			.map(|index| if index < 8 { vec![1, 2] } else { vec![1] })
			.collect();
		let slices: Vec<&[u32]> = at_quorum.iter().map(Vec::as_slice).collect();
		assert_eq!(compute_quorum_core(&slices), vec![1, 2]);
	}

	#[test]
	fn falls_back_to_the_union_when_no_token_clears_the_bar() {
		let members: Vec<&[u32]> = vec![&[3, 1], &[2]];
		assert_eq!(compute_quorum_core(&members), vec![1, 2, 3]);
		// The strict size does not fall back.
		assert_eq!(strict_quorum_core_size(&members), 0);
	}

	#[test]
	fn a_single_member_is_its_own_core() {
		let members: Vec<&[u32]> = vec![&[5, 4]];
		assert_eq!(compute_quorum_core(&members), vec![4, 5]);
		assert_eq!(strict_quorum_core_size(&members), 2);
	}
}
