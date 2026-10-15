use rustc_hash::{FxHashMap, FxHashSet};

/// Resolves every `source → destination` hop to the node a chain of hops
/// finally lands on.
///
/// `hops` holds the hops (redirects and aliases, which a row never has both
/// of); a source that appears twice keeps its **last** hop. The result maps
/// each source to the node its chain ends on, which is not a source itself,
/// or to `None` when the chain never ends: a source that loops back to itself
/// or to an earlier one, and every source whose chain leads into such a loop
/// (a tail merging into a cycle). A node that is not a source resolves to
/// itself, so it has no entry.
///
/// Each source is walked once however many chains pass through it, so the
/// work is linear in the number of hops.
///
/// # Examples
///
/// ```
/// use nitpicker_union_find::resolve_canonical;
///
/// // 1 → 2 → 3, and 4 ↔ 5 loop, 6 leads into the loop.
/// let resolved = resolve_canonical(&[(1, 2), (2, 3), (4, 5), (5, 4), (6, 4)]);
/// assert_eq!(resolved[&1], Some(3));
/// assert_eq!(resolved[&2], Some(3));
/// assert_eq!(resolved[&4], None);
/// assert_eq!(resolved[&6], None);
/// assert!(!resolved.contains_key(&3));
/// ```
#[must_use]
pub fn resolve_canonical(hops: &[(u32, u32)]) -> FxHashMap<u32, Option<u32>> {
	let mut next: FxHashMap<u32, u32> = FxHashMap::default();
	next.reserve(hops.len());
	for &(source, destination) in hops {
		next.insert(source, destination);
	}

	let mut resolved: FxHashMap<u32, Option<u32>> = FxHashMap::default();
	resolved.reserve(next.len());
	let mut path: Vec<u32> = Vec::new();
	let mut on_path: FxHashSet<u32> = FxHashSet::default();
	for &start in next.keys() {
		if resolved.contains_key(&start) {
			continue;
		}
		path.clear();
		on_path.clear();
		let mut current = start;
		let landing = loop {
			if let Some(&known) = resolved.get(&current) {
				break known;
			}
			let Some(&destination) = next.get(&current) else {
				break Some(current);
			};
			if !on_path.insert(current) {
				break None;
			}
			path.push(current);
			current = destination;
		};
		for &node in &path {
			resolved.insert(node, landing);
		}
	}
	resolved
}

#[cfg(test)]
mod tests {
	use super::resolve_canonical;

	#[test]
	fn follows_a_chain_to_its_end() {
		let resolved = resolve_canonical(&[(1, 2), (2, 3), (3, 4)]);
		assert_eq!(resolved[&1], Some(4));
		assert_eq!(resolved[&3], Some(4));
		assert!(!resolved.contains_key(&4));
	}

	#[test]
	fn drops_a_self_loop() {
		assert_eq!(resolve_canonical(&[(7, 7)])[&7], None);
	}

	#[test]
	fn drops_a_cycle_and_the_tail_that_leads_into_it() {
		let resolved = resolve_canonical(&[(1, 2), (2, 1), (3, 1), (4, 3), (5, 6), (6, 7)]);
		assert_eq!(resolved[&1], None);
		assert_eq!(resolved[&2], None);
		assert_eq!(resolved[&3], None);
		assert_eq!(resolved[&4], None);
		assert_eq!(resolved[&5], Some(7));
	}

	#[test]
	fn shares_the_walk_between_chains_that_merge() {
		let resolved = resolve_canonical(&[(1, 3), (2, 3), (3, 4), (5, 3)]);
		assert_eq!(resolved[&1], Some(4));
		assert_eq!(resolved[&2], Some(4));
		assert_eq!(resolved[&5], Some(4));
	}

	#[test]
	fn keeps_the_last_hop_of_a_repeated_source() {
		let resolved = resolve_canonical(&[(1, 2), (1, 3)]);
		assert_eq!(resolved[&1], Some(3));
	}

	#[test]
	fn resolves_nothing_without_hops() {
		assert!(resolve_canonical(&[]).is_empty());
	}
}
