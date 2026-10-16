use rustc_hash::FxHashMap;

use crate::resolve_canonical::resolve_canonical;
use crate::union_find::UnionFind;

/// The connected components of the pages (the candidates) a set of link
/// edges joins, read edge batch by edge batch.
///
/// An edge `page → href` counts when `page` is a candidate, `href` — once
/// redirects and aliases are followed ([`resolve_canonical`]) — is a
/// candidate too, and the two differ. Edges are weakly connected (their
/// direction is ignored). An edge whose `href` sits in a chain that never
/// ends is dropped.
///
/// # Examples
///
/// ```
/// use nitpicker_union_find::IsolatedGraph;
///
/// // Candidates 10, 20, 30; page 40 redirects to 30 and is not a candidate.
/// let mut graph = IsolatedGraph::new(&[10, 20, 30], &[(40, 30)]);
/// graph.add_edges(&[(10, 20), (20, 40)]);
/// assert_eq!(graph.labels(), [0, 0, 0]);
/// ```
#[derive(Debug)]
pub struct IsolatedGraph {
	index_of: FxHashMap<u32, u32>,
	canonical: FxHashMap<u32, Option<u32>>,
	sets: UnionFind,
}

impl IsolatedGraph {
	/// Starts with `candidates` (in the order the components are numbered:
	/// ascending page id for the read model) each alone, and `hops` the
	/// redirect and alias hops of the whole archive.
	///
	/// # Panics
	///
	/// Panics when there are more than `u32::MAX` candidates.
	#[must_use]
	pub fn new(candidates: &[u32], hops: &[(u32, u32)]) -> Self {
		let mut index_of: FxHashMap<u32, u32> = FxHashMap::default();
		index_of.reserve(candidates.len());
		for (index, &id) in candidates.iter().enumerate() {
			index_of.insert(
				id,
				u32::try_from(index).expect("fewer than 2^32 candidates"),
			);
		}
		Self {
			index_of,
			canonical: resolve_canonical(hops),
			sets: UnionFind::new(candidates.len()),
		}
	}

	/// Joins the pages of a batch of `(page, href)` edges. Batches may come in
	/// any order and size: the components are the same.
	pub fn add_edges(&mut self, edges: &[(u32, u32)]) {
		for &(page, href) in edges {
			let Some(&from) = self.index_of.get(&page) else {
				continue;
			};
			let landing = match self.canonical.get(&href) {
				Some(&Some(landing)) => landing,
				Some(&None) => continue,
				None => href,
			};
			let Some(&to) = self.index_of.get(&landing) else {
				continue;
			};
			if from != to {
				self.sets.union(from, to);
			}
		}
	}

	/// For each candidate, in the order given to [`IsolatedGraph::new`], the
	/// number of its component, counted in order of first appearance.
	pub fn labels(&mut self) -> Vec<u32> {
		self.sets.labels()
	}
}

#[cfg(test)]
mod tests {
	use super::IsolatedGraph;

	#[test]
	fn joins_pages_in_either_direction() {
		let mut graph = IsolatedGraph::new(&[1, 2, 3, 4], &[]);
		graph.add_edges(&[(2, 1), (3, 4)]);
		assert_eq!(graph.labels(), [0, 0, 1, 1]);
	}

	#[test]
	fn leaves_unlinked_pages_alone() {
		let mut graph = IsolatedGraph::new(&[5, 6, 7], &[]);
		graph.add_edges(&[]);
		assert_eq!(graph.labels(), [0, 1, 2]);
	}

	#[test]
	fn ignores_self_links_and_pages_that_are_not_candidates() {
		let mut graph = IsolatedGraph::new(&[1, 2], &[]);
		graph.add_edges(&[(1, 1), (1, 99), (99, 2)]);
		assert_eq!(graph.labels(), [0, 1]);
	}

	#[test]
	fn follows_a_redirect_to_its_destination() {
		// 9 redirects to 2: an edge to 9 is an edge to 2.
		let mut graph = IsolatedGraph::new(&[1, 2], &[(9, 2)]);
		graph.add_edges(&[(1, 9)]);
		assert_eq!(graph.labels(), [0, 0]);
	}

	#[test]
	fn follows_alias_then_redirect_then_alias() {
		// 8 (alias) → 9 (redirect) → 7 (alias) → 2.
		let mut graph = IsolatedGraph::new(&[1, 2], &[(8, 9), (9, 7), (7, 2)]);
		graph.add_edges(&[(1, 8)]);
		assert_eq!(graph.labels(), [0, 0]);
	}

	#[test]
	fn drops_an_edge_into_a_loop_and_into_a_tail_that_leads_to_one() {
		// 8 ↔ 9 loop; 7 leads into it. Neither edge joins anything.
		let mut graph = IsolatedGraph::new(&[1, 2, 3], &[(8, 9), (9, 8), (7, 8)]);
		graph.add_edges(&[(1, 8), (2, 7)]);
		assert_eq!(graph.labels(), [0, 1, 2]);
	}

	#[test]
	fn counts_a_redirect_that_lands_on_the_page_itself_as_a_self_link() {
		let mut graph = IsolatedGraph::new(&[1, 2], &[(9, 1)]);
		graph.add_edges(&[(1, 9)]);
		assert_eq!(graph.labels(), [0, 1]);
	}

	#[test]
	fn numbers_components_by_their_first_candidate() {
		let mut graph = IsolatedGraph::new(&[10, 20, 30, 40], &[]);
		graph.add_edges(&[(40, 20)]);
		assert_eq!(graph.labels(), [0, 1, 2, 1]);
	}

	#[test]
	fn gives_the_same_components_however_the_edges_are_batched() {
		let edges = [(1, 2), (3, 4), (2, 3), (5, 5), (6, 1)];
		let mut whole = IsolatedGraph::new(&[1, 2, 3, 4, 5, 6], &[]);
		whole.add_edges(&edges);
		let mut split = IsolatedGraph::new(&[1, 2, 3, 4, 5, 6], &[]);
		for edge in edges.iter().rev() {
			split.add_edges(&[*edge]);
		}
		assert_eq!(whole.labels(), split.labels());
	}
}
