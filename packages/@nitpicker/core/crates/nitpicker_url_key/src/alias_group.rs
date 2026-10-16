use std::cmp::Ordering;

use nitpicker_union_find::UnionFind;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::alias_key::alias_keys;

/// One page that may be the same page as another under a different URL.
#[derive(Debug, Clone, Copy)]
pub struct AliasCandidate<'a> {
	/// The page's URL.
	pub url: &'a str,
	/// The id of that URL string (`url_refs.id`): two candidates have the same
	/// URL exactly when they have the same id.
	pub url_id: u32,
	/// The id of the page's `<title>` text. Pages with different titles are
	/// never grouped.
	pub title_text_id: u32,
	/// The id of the URL the page's `<link rel="canonical">` points at.
	pub canonical_url_id: Option<u32>,
	/// The page's body hash; without one the page is grouped by URL form only.
	pub body_hash: Option<&'a [u8]>,
}

/// Groups candidates that are the same page under another URL, and elects
/// each group's representative.
///
/// Two candidates are in one group when a chain of the following links them:
///
/// - **Tier A**: the same title and the same Tier A key ([`alias_keys`]), or
/// - **Tier B**: the same title, the same Tier B key **and** the same body
///   hash (a candidate without a body hash is not grouped this way).
///
/// A candidate whose URL gives no key (not `http(s)`, or not a URL) is not
/// grouped by it. Each tier on its own is an equivalence, but the two
/// together are not, which is why the groups are the connected components of
/// both rather than a bucket of either.
///
/// The representative of a group of two or more is elected in turn by:
///
/// 1. most `<link rel="canonical">` declarations **within the group** that
///    point at its URL (a page that is only pointed at by outsiders does not
///    count; when no member is pointed at, every member stays in the running),
/// 2. the shortest URL, in UTF-16 code units,
/// 3. the smallest URL, by UTF-16 code unit order.
///
/// URLs are distinct, so the election does not depend on the order of the
/// candidates.
///
/// Returns, for each candidate, the index of its group's representative; a
/// representative and a candidate in a group of one have `None`.
///
/// # Panics
///
/// Panics when there are more than `u32::MAX` candidates.
///
/// # Examples
///
/// ```
/// use nitpicker_url_key::{AliasCandidate, group_alias_candidates};
///
/// let page = |url| AliasCandidate {
///     url,
///     url_id: 0,
///     title_text_id: 1,
///     canonical_url_id: None,
///     body_hash: None,
/// };
/// let candidates = [
///     AliasCandidate { url_id: 1, ..page("https://example.com/about/index.html") },
///     AliasCandidate { url_id: 2, ..page("https://example.com/about/") },
///     AliasCandidate { url_id: 3, ..page("https://example.com/contact/") },
/// ];
/// // The shortest URL wins: the first page points at the second.
/// assert_eq!(group_alias_candidates(&candidates), [Some(1), None, None]);
/// ```
#[must_use]
pub fn group_alias_candidates(candidates: &[AliasCandidate<'_>]) -> Vec<Option<u32>> {
	let mut sets = UnionFind::new(candidates.len());
	let mut tier_a: FxHashMap<(String, u32), u32> = FxHashMap::default();
	let mut tier_b: FxHashMap<(String, u32, &[u8]), u32> = FxHashMap::default();

	for (index, candidate) in candidates.iter().enumerate() {
		let index = u32::try_from(index).expect("fewer than 2^32 candidates");
		let Some(keys) = alias_keys(candidate.url) else {
			continue;
		};
		match tier_a.entry((keys.tier_a, candidate.title_text_id)) {
			std::collections::hash_map::Entry::Occupied(first) => {
				sets.union(*first.get(), index);
			}
			std::collections::hash_map::Entry::Vacant(slot) => {
				slot.insert(index);
			}
		}
		if let Some(body_hash) = candidate.body_hash {
			match tier_b.entry((keys.tier_b, candidate.title_text_id, body_hash)) {
				std::collections::hash_map::Entry::Occupied(first) => {
					sets.union(*first.get(), index);
				}
				std::collections::hash_map::Entry::Vacant(slot) => {
					slot.insert(index);
				}
			}
		}
	}

	let mut groups: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
	for index in 0..candidates.len() {
		let index = u32::try_from(index).expect("fewer than 2^32 candidates");
		groups.entry(sets.find(index)).or_default().push(index);
	}

	let mut representative = vec![None; candidates.len()];
	for members in groups.values().filter(|members| members.len() > 1) {
		let elected = elect_representative(candidates, members);
		for &member in members {
			if member != elected {
				representative[member as usize] = Some(elected);
			}
		}
	}
	representative
}

/// Elects the representative of a group (two or more members) by the rules
/// of [`group_alias_candidates`].
fn elect_representative(candidates: &[AliasCandidate<'_>], members: &[u32]) -> u32 {
	let member_url_ids: FxHashSet<u32> = members
		.iter()
		.map(|&member| candidates[member as usize].url_id)
		.collect();
	let mut pointed_at: FxHashMap<u32, u32> = FxHashMap::default();
	for &member in members {
		if let Some(canonical) = candidates[member as usize].canonical_url_id
			&& member_url_ids.contains(&canonical)
		{
			*pointed_at.entry(canonical).or_insert(0) += 1;
		}
	}
	let rank = |member: u32| {
		pointed_at
			.get(&candidates[member as usize].url_id)
			.copied()
			.unwrap_or(0)
	};

	// Only pointed-at members stay in the running when any is. The rank
	// comparison below would already keep an unpointed member from winning, so
	// the filter changes no result; it states the rule as the election is
	// defined (see [`group_alias_candidates`]).
	let mut pool = members
		.iter()
		.copied()
		.filter(|&member| pointed_at.is_empty() || rank(member) > 0);
	let mut best = pool.next().expect("a group has members");
	for current in pool {
		let by_rank = rank(current).cmp(&rank(best)).reverse();
		let url = |member: u32| candidates[member as usize].url;
		let ordering = by_rank
			.then_with(|| {
				url(current)
					.encode_utf16()
					.count()
					.cmp(&url(best).encode_utf16().count())
			})
			.then_with(|| url(current).encode_utf16().cmp(url(best).encode_utf16()));
		if ordering == Ordering::Less {
			best = current;
		}
	}
	best
}

#[cfg(test)]
mod tests {
	use super::{AliasCandidate, group_alias_candidates};

	fn page(url: &str, url_id: u32) -> AliasCandidate<'_> {
		AliasCandidate {
			url,
			url_id,
			title_text_id: 1,
			canonical_url_id: None,
			body_hash: None,
		}
	}

	#[test]
	fn groups_pages_with_the_same_tier_a_key_and_title() {
		let candidates = [
			page("http://example.com/a/index.html", 1),
			page("https://example.com/a/", 2),
			page("https://example.com/b/", 3),
		];
		assert_eq!(group_alias_candidates(&candidates), [Some(1), None, None]);
	}

	#[test]
	fn never_groups_pages_with_different_titles() {
		let mut other = page("https://example.com/a/", 2);
		other.title_text_id = 2;
		let candidates = [page("http://example.com/a/index.html", 1), other];
		assert_eq!(group_alias_candidates(&candidates), [None, None]);
	}

	#[test]
	fn groups_by_tier_b_only_with_the_same_body_hash() {
		const SAME: [u8; 32] = [7; 32];
		const OTHER: [u8; 32] = [8; 32];
		let with_hash = |url, url_id, hash: &'static [u8; 32]| AliasCandidate {
			body_hash: Some(hash),
			..page(url, url_id)
		};
		let grouped = [
			with_hash("https://example.com/foo", 1, &SAME),
			with_hash("https://example.com/foo/", 2, &SAME),
		];
		assert_eq!(group_alias_candidates(&grouped), [None, Some(0)]);
		let split = [
			with_hash("https://example.com/foo", 1, &SAME),
			with_hash("https://example.com/foo/", 2, &OTHER),
		];
		assert_eq!(group_alias_candidates(&split), [None, None]);
		let without_hash = [
			page("https://example.com/foo", 1),
			page("https://example.com/foo/", 2),
		];
		assert_eq!(group_alias_candidates(&without_hash), [None, None]);
	}

	#[test]
	fn closes_a_tier_a_edge_and_a_tier_b_edge_into_one_group() {
		// /x/index.html ~A~ /x/ ~B~ /x (same hash): all three are one group.
		let hash = [1_u8; 32];
		let candidates = [
			AliasCandidate {
				body_hash: Some(&hash),
				..page("https://example.com/x/index.html", 1)
			},
			AliasCandidate {
				body_hash: Some(&hash),
				..page("https://example.com/x/", 2)
			},
			AliasCandidate {
				body_hash: Some(&hash),
				..page("https://example.com/x", 3)
			},
		];
		let result = group_alias_candidates(&candidates);
		let representatives = result.iter().filter(|r| r.is_none()).count();
		assert_eq!(representatives, 1);
		// "https://example.com/x" is the shortest.
		assert_eq!(result, [Some(2), Some(2), None]);
	}

	#[test]
	fn leaves_urls_without_a_key_alone() {
		let candidates = [
			page("mailto:a@example.com", 1),
			page("mailto:a@example.com", 2),
		];
		assert_eq!(group_alias_candidates(&candidates), [None, None]);
	}

	#[test]
	fn prefers_the_page_the_group_points_at_with_canonical() {
		// The longer URL is the one both pages declare as canonical.
		let long = AliasCandidate {
			canonical_url_id: Some(1),
			..page("http://example.com/a/index.html", 1)
		};
		let short = AliasCandidate {
			canonical_url_id: Some(1),
			..page("https://example.com/a/", 2)
		};
		assert_eq!(group_alias_candidates(&[long, short]), [None, Some(0)]);
	}

	#[test]
	fn never_groups_a_tier_b_pair_whose_titles_differ() {
		const HASH: [u8; 32] = [3; 32];
		let mut other_title = page("https://example.com/foo/", 2);
		other_title.title_text_id = 2;
		other_title.body_hash = Some(&HASH);
		let candidates = [
			AliasCandidate {
				body_hash: Some(&HASH),
				..page("https://example.com/foo", 1)
			},
			other_title,
		];
		assert_eq!(group_alias_candidates(&candidates), [None, None]);
	}

	#[test]
	fn elects_the_page_most_canonicals_point_at_over_a_shorter_one_pointed_at_once() {
		// All three share the Tier A key `example.com/a/`. P2 is pointed at by
		// P1 and P3 (two canonicals), P1 only by P2 (one): P2 wins although P1
		// is the shortest URL.
		let candidates = [
			AliasCandidate {
				canonical_url_id: Some(2),
				..page("https://example.com/a/", 1)
			},
			AliasCandidate {
				canonical_url_id: Some(1),
				..page("https://example.com/a/index.php", 2)
			},
			AliasCandidate {
				canonical_url_id: Some(2),
				..page("https://example.com/a/index.html", 3)
			},
		];
		assert_eq!(
			group_alias_candidates(&candidates),
			[Some(1), None, Some(1)]
		);
	}

	#[test]
	fn ignores_a_canonical_that_points_outside_the_group() {
		let long = AliasCandidate {
			canonical_url_id: Some(99),
			..page("http://example.com/a/index.html", 1)
		};
		let short = page("https://example.com/a/", 2);
		assert_eq!(group_alias_candidates(&[long, short]), [Some(1), None]);
	}

	#[test]
	fn prefers_the_shorter_url_over_the_smaller_one() {
		// Both fold to one key; ".php" is shorter than ".html" though ".html" is smaller.
		let candidates = [
			page("https://example.com/a/index.php", 1),
			page("https://example.com/a/index.html", 2),
		];
		assert_eq!(group_alias_candidates(&candidates), [None, Some(0)]);
	}

	#[test]
	fn breaks_a_length_tie_by_the_smaller_url() {
		// Same key (the host's case folds), same length: "E" sorts before "e".
		let candidates = [
			page("https://example.com/a/", 1),
			page("https://Example.com/a/", 2),
		];
		assert_eq!(group_alias_candidates(&candidates), [Some(1), None]);
	}

	#[test]
	fn does_not_depend_on_the_order_of_the_candidates() {
		let a = page("http://example.com/a/index.html", 1);
		let b = page("https://example.com/a/", 2);
		let c = page("https://example.com/a/index.php", 3);
		let forward = group_alias_candidates(&[a, b, c]);
		let reverse = group_alias_candidates(&[c, b, a]);
		// Index 1 (b) wins in both: the shortest URL.
		assert_eq!(forward, [Some(1), None, Some(1)]);
		assert_eq!(reverse, [Some(1), None, Some(1)]);
	}
}
