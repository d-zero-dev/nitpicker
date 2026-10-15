//! Properties of the components over random edges: they depend on neither the
//! order of the edges nor how they were batched, and the labels are numbered
//! by first appearance in node order — the guarantees the read model's
//! `component_id` rests on.

use std::collections::HashMap;

use nitpicker_union_find::{IsolatedGraph, resolve_canonical};
use proptest::prelude::*;

/// A list of `(from, to)` id pairs.
type Pairs = Vec<(u32, u32)>;

/// Candidate ids 1..=n, hops and edges drawn from a slightly larger id range
/// so some edges leave the candidate set and some hops form loops.
fn graph() -> impl Strategy<Value = (u32, Pairs, Pairs)> {
	(2_u32..30).prop_flat_map(|n| {
		let id = 1..=n + 3;
		(
			Just(n),
			prop::collection::vec((id.clone(), id.clone()), 0..12),
			prop::collection::vec((1..=n, id), 0..60),
		)
	})
}

fn labels(n: u32, hops: &[(u32, u32)], batches: &[&[(u32, u32)]]) -> Vec<u32> {
	let candidates: Vec<u32> = (1..=n).collect();
	let mut graph = IsolatedGraph::new(&candidates, hops);
	for batch in batches {
		graph.add_edges(batch);
	}
	graph.labels()
}

/// Where `start` lands following `hops` (a source listed twice keeps its last
/// hop), walking one step at a time: `None` when it is still on a hop's source
/// after more steps than there are hops, which only a loop does.
fn naive_landing(hops: &[(u32, u32)], start: u32) -> Option<u32> {
	let next: HashMap<u32, u32> = hops.iter().copied().collect();
	let mut current = start;
	for _ in 0..=next.len() {
		match next.get(&current) {
			Some(&destination) => current = destination,
			None => return Some(current),
		}
	}
	None
}

/// The components by the plainest means: resolve each edge's destination with
/// [`naive_landing`], keep the edges between two different candidates, relax
/// the smallest component number along them until nothing changes, then
/// number the components by first appearance.
fn naive_labels(n: u32, hops: &[(u32, u32)], edges: &[(u32, u32)]) -> Vec<u32> {
	let candidate = |id: u32| (1..=n).contains(&id);
	let pairs: Vec<(usize, usize)> = edges
		.iter()
		.filter_map(|&(page, href)| {
			let landing = naive_landing(hops, href)?;
			(candidate(page) && candidate(landing) && page != landing)
				.then(|| ((page - 1) as usize, (landing - 1) as usize))
		})
		.collect();
	let mut component: Vec<u32> = (0..n).collect();
	loop {
		let mut changed = false;
		for &(a, b) in &pairs {
			let lowest = component[a].min(component[b]);
			for node in [a, b] {
				if component[node] != lowest {
					component[node] = lowest;
					changed = true;
				}
			}
		}
		if !changed {
			break;
		}
	}
	let mut label_of: HashMap<u32, u32> = HashMap::new();
	component
		.iter()
		.map(|&number| {
			let next = u32::try_from(label_of.len()).expect("few components");
			*label_of.entry(number).or_insert(next)
		})
		.collect()
}

proptest! {
	#[test]
	fn the_components_match_a_step_by_step_reference((n, hops, edges) in graph()) {
		prop_assert_eq!(
			labels(n, &hops, &[&edges]),
			naive_labels(n, &hops, &edges)
		);
	}

	#[test]
	fn every_hop_source_resolves_like_a_step_by_step_walk((_n, hops, _edges) in graph()) {
		let resolved = resolve_canonical(&hops);
		for &(source, _) in &hops {
			prop_assert_eq!(
				resolved.get(&source).copied(),
				Some(naive_landing(&hops, source))
			);
		}
		prop_assert_eq!(resolved.len(), hops.iter().map(|&(source, _)| source).collect::<std::collections::HashSet<_>>().len());
	}

	#[test]
	fn edge_order_and_batching_do_not_change_the_components(
		(n, hops, edges) in graph(),
		seed in any::<u64>(),
	) {
		let whole = labels(n, &hops, &[&edges]);

		let mut shuffled = edges.clone();
		// A deterministic shuffle: rotate by the seed, then reverse.
		if !shuffled.is_empty() {
			let by = usize::try_from(seed % shuffled.len() as u64).unwrap_or(0);
			shuffled.rotate_left(by);
		}
		shuffled.reverse();
		prop_assert_eq!(&whole, &labels(n, &hops, &[&shuffled]));

		let singles: Vec<&[(u32, u32)]> = edges.chunks(1).collect();
		prop_assert_eq!(&whole, &labels(n, &hops, &singles));
	}

	#[test]
	fn labels_count_up_in_node_order((n, hops, edges) in graph()) {
		let result = labels(n, &hops, &[&edges]);
		let mut highest_seen = None;
		for label in result {
			match highest_seen {
				None => prop_assert_eq!(label, 0),
				Some(highest) => prop_assert!(label <= highest + 1),
			}
			highest_seen = Some(highest_seen.map_or(label, |highest: u32| highest.max(label)));
		}
	}
}
