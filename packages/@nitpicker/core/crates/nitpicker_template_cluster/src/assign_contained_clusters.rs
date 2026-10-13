use rustc_hash::{FxHashMap, FxHashSet};

/// Containment (`|X ∩ Y| / |X|`) at or above which cluster X is folded into
/// Y. Measured template-subset pairs (a page missing an optional section)
/// sit between 0.90 and 1; unrelated clusters well below 0.8.
const CONTAINMENT_CUTOFF: f64 = 0.9;

/// One cluster for containment: its id, the union of its pages' tokens and
/// its page count (the last tie-breaker).
pub struct ContainedClusterEntry {
	/// Cluster id.
	pub id: usize,
	/// Union of the members' tokens.
	pub tokens: FxHashSet<u32>,
	/// Member pages.
	pub page_count: usize,
}

fn containment_shared(x: &FxHashSet<u32>, y: &FxHashSet<u32>) -> usize {
	x.iter().filter(|token| y.contains(token)).count()
}

/// The cluster `x` folds into: the best one containing it (highest
/// containment, then largest union, then most pages; ties keep the earlier
/// cluster), or `None`.
fn best_container(x: &ContainedClusterEntry, clusters: &[ContainedClusterEntry]) -> Option<usize> {
	if x.tokens.is_empty() {
		return None;
	}
	let mut best_target: Option<usize> = None;
	let mut best_containment = CONTAINMENT_CUTOFF - 1e-9;
	let mut best_union = 0usize;
	let mut best_page_count = 0usize;
	for y in clusters {
		if y.id == x.id {
			continue;
		}
		let shared = containment_shared(&x.tokens, &y.tokens);
		// Counts stay far below 2^52; the conversions are exact.
		#[allow(clippy::cast_precision_loss)]
		let containment = shared as f64 / x.tokens.len() as f64;
		if containment < CONTAINMENT_CUTOFF {
			continue;
		}
		let union = x.tokens.len() + y.tokens.len() - shared;
		#[allow(clippy::float_cmp)]
		let better = containment > best_containment
			|| (containment == best_containment && union > best_union)
			|| (containment == best_containment
				&& union == best_union
				&& y.page_count > best_page_count);
		if better {
			best_containment = containment;
			best_union = union;
			best_page_count = y.page_count;
			best_target = Some(y.id);
		}
	}
	best_target
}

/// Folds each cluster into the best cluster containing it — highest
/// containment, then largest union, then most pages — returning each id's
/// root (itself when nothing contains it).
///
/// Directed, not union-find: clusters contained in one superset page do
/// not merge with each other, only into it (a pure union-find chained nine
/// unrelated clusters through one page carrying every nav variant).
/// Conditional rendering only removes elements, so a page short of a
/// section is a subset of the full template. Mutual containment (a cycle)
/// means practically equal sets; the largest set (then most pages) roots it.
#[must_use]
pub fn assign_contained_clusters(clusters: &[ContainedClusterEntry]) -> FxHashMap<usize, usize> {
	let raw: FxHashMap<usize, usize> = clusters
		.iter()
		.filter_map(|x| best_container(x, clusters).map(|target| (x.id, target)))
		.collect();

	let by_id: FxHashMap<usize, &ContainedClusterEntry> = clusters
		.iter()
		.map(|cluster| (cluster.id, cluster))
		.collect();
	let size_of = |id: usize| by_id.get(&id).map_or(0, |cluster| cluster.tokens.len());
	let pages_of = |id: usize| by_id.get(&id).map_or(0, |cluster| cluster.page_count);

	let mut resolved: FxHashMap<usize, usize> = FxHashMap::default();
	for cluster in clusters {
		if resolved.contains_key(&cluster.id) {
			continue;
		}
		let mut path: Vec<usize> = Vec::new();
		let mut on_path: FxHashSet<usize> = FxHashSet::default();
		let mut current = cluster.id;
		while !resolved.contains_key(&current) {
			let Some(&next) = raw.get(&current) else {
				resolved.insert(current, current);
				break;
			};
			if on_path.contains(&next) {
				let cycle_start = path
					.iter()
					.position(|&id| id == next)
					.expect("next is on the path");
				let mut cycle: Vec<usize> = path[cycle_start..].to_vec();
				cycle.push(current);
				let mut root = cycle[0];
				for &id in &cycle {
					if size_of(id) > size_of(root)
						|| (size_of(id) == size_of(root) && pages_of(id) > pages_of(root))
					{
						root = id;
					}
				}
				for &id in &cycle {
					resolved.insert(id, root);
				}
				for &id in &path[..cycle_start] {
					resolved.insert(id, root);
				}
				break;
			}
			if let Some(&root) = resolved.get(&next) {
				resolved.insert(current, root);
				for &id in &path {
					resolved.insert(id, root);
				}
				break;
			}
			path.push(current);
			on_path.insert(current);
			current = next;
		}
		if !resolved.contains_key(&cluster.id)
			&& let Some(&root) = resolved.get(&current)
		{
			for &id in &path {
				resolved.insert(id, root);
			}
		}
	}
	for cluster in clusters {
		resolved.entry(cluster.id).or_insert(cluster.id);
	}
	resolved
}

/// `token` with the bare `div` / `span` segments between its first and last
/// segment removed, so clusters differing only in anonymous wrappers compare
/// equal. Splits on every `>`, including one inside a class name, as the
/// stored keys were computed.
#[must_use]
pub fn collapse_anonymous_divs(token: &str) -> String {
	let segments: Vec<&str> = token.split('>').collect();
	if segments.len() <= 2 {
		return token.to_owned();
	}
	let last = segments.len() - 1;
	let mut kept: Vec<&str> = Vec::with_capacity(segments.len());
	kept.push(segments[0]);
	kept.extend(
		segments[1..last]
			.iter()
			.copied()
			.filter(|segment| *segment != "div" && *segment != "span"),
	);
	kept.push(segments[last]);
	kept.join(">")
}

#[cfg(test)]
mod tests {
	use rustc_hash::FxHashSet;

	use super::{ContainedClusterEntry, assign_contained_clusters, collapse_anonymous_divs};

	fn entry(id: usize, tokens: &[u32], page_count: usize) -> ContainedClusterEntry {
		ContainedClusterEntry {
			id,
			tokens: tokens.iter().copied().collect::<FxHashSet<u32>>(),
			page_count,
		}
	}

	#[test]
	fn folds_a_subset_into_its_superset_without_chaining_siblings() {
		let clusters = vec![
			entry(0, &(0..10).collect::<Vec<_>>(), 5),
			entry(1, &(0..9).collect::<Vec<_>>(), 3),
			// Shares 8 of its 10 tokens with cluster 0: containment 0.8.
			entry(2, &[0, 1, 2, 3, 4, 5, 6, 7, 20, 21], 2),
			entry(3, &[50, 51], 1),
		];
		let roots = assign_contained_clusters(&clusters);
		assert_eq!(roots[&1], 0);
		assert_eq!(roots[&2], 2);
		assert_eq!(roots[&3], 3);
		assert_eq!(roots[&0], 0);
	}

	#[test]
	fn roots_a_mutual_pair_at_the_larger_set() {
		let big: Vec<u32> = (0..20).collect();
		let mut almost: Vec<u32> = (0..19).collect();
		almost.push(99);
		let clusters = vec![entry(0, &almost, 1), entry(1, &big, 1)];
		let roots = assign_contained_clusters(&clusters);
		assert_eq!(roots[&0], roots[&1]);
	}

	#[test]
	fn collapses_interior_bare_wrappers_only() {
		assert_eq!(
			collapse_anonymous_divs("body>main>div>section.c-x>span>.card"),
			"body>main>section.c-x>.card"
		);
		assert_eq!(collapse_anonymous_divs("body>div"), "body>div");
		assert_eq!(collapse_anonymous_divs("div>div>div"), "div>div");
	}

	#[test]
	fn collapses_spans_and_runs_but_keeps_classed_bracketed_and_semantic_segments() {
		assert_eq!(collapse_anonymous_divs("body>div>section"), "body>section");
		assert_eq!(collapse_anonymous_divs("body>span>section"), "body>section");
		assert_eq!(
			collapse_anonymous_divs("body>div>div>section"),
			"body>section"
		);
		assert_eq!(
			collapse_anonymous_divs("body>div.class>section"),
			"body>div.class>section"
		);
		assert_eq!(
			collapse_anonymous_divs("body>div[role=main]>section"),
			"body>div[role=main]>section"
		);
		assert_eq!(collapse_anonymous_divs("div>main>span"), "div>main>span");
		assert_eq!(
			collapse_anonymous_divs("body>main>section"),
			"body>main>section"
		);
	}
}
