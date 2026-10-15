/// Disjoint sets over the nodes `0..n`: union by size, with path halving.
///
/// Both keep every operation iterative (no recursion, so a long chain cannot
/// overflow the stack) and nearly constant in time.
///
/// # Examples
///
/// ```
/// let mut sets = nitpicker_union_find::UnionFind::new(4);
/// sets.union(0, 2);
/// sets.union(3, 2);
/// assert_eq!(sets.labels(), [0, 1, 0, 0]);
/// ```
#[derive(Debug, Clone)]
pub struct UnionFind {
	parent: Vec<u32>,
	size: Vec<u32>,
}

impl UnionFind {
	/// `n` nodes, each alone in its set.
	///
	/// # Panics
	///
	/// Panics when `n` is more than `u32::MAX`.
	#[must_use]
	pub fn new(n: usize) -> Self {
		let count = u32::try_from(n).expect("fewer than 2^32 nodes");
		Self {
			parent: (0..count).collect(),
			size: vec![1; n],
		}
	}

	/// How many nodes there are.
	#[must_use]
	pub fn len(&self) -> usize {
		self.parent.len()
	}

	/// Whether there are no nodes.
	#[must_use]
	pub fn is_empty(&self) -> bool {
		self.parent.is_empty()
	}

	/// The representative of `x`'s set.
	///
	/// # Panics
	///
	/// Panics when `x` is not a node.
	pub fn find(&mut self, x: u32) -> u32 {
		let mut node = x;
		while self.parent[node as usize] != node {
			let grandparent = self.parent[self.parent[node as usize] as usize];
			self.parent[node as usize] = grandparent;
			node = grandparent;
		}
		node
	}

	/// Puts `a` and `b` in one set; returns whether they were in two.
	///
	/// # Panics
	///
	/// Panics when `a` or `b` is not a node.
	pub fn union(&mut self, a: u32, b: u32) -> bool {
		let (mut root_a, mut root_b) = (self.find(a), self.find(b));
		if root_a == root_b {
			return false;
		}
		if self.size[root_a as usize] < self.size[root_b as usize] {
			std::mem::swap(&mut root_a, &mut root_b);
		}
		self.parent[root_b as usize] = root_a;
		self.size[root_a as usize] += self.size[root_b as usize];
		true
	}

	/// Numbers the sets: for each node, the number of its set, counting from
	/// 0 in the order the sets are first met walking the nodes `0..n`. So the
	/// set of node 0 is 0, and a set's number is smaller than another's when
	/// its smallest node is.
	pub fn labels(&mut self) -> Vec<u32> {
		let mut label_of_root = vec![u32::MAX; self.parent.len()];
		let mut next = 0_u32;
		let mut labels = Vec::with_capacity(self.parent.len());
		for node in 0..self.parent.len() {
			let root = self.find(u32::try_from(node).unwrap_or(u32::MAX)) as usize;
			if label_of_root[root] == u32::MAX {
				label_of_root[root] = next;
				next += 1;
			}
			labels.push(label_of_root[root]);
		}
		labels
	}
}

#[cfg(test)]
mod tests {
	use super::UnionFind;

	#[test]
	fn starts_with_every_node_alone() {
		let mut sets = UnionFind::new(3);
		assert_eq!(sets.labels(), [0, 1, 2]);
		assert_eq!(sets.len(), 3);
	}

	#[test]
	fn reports_whether_a_union_joined_two_sets() {
		let mut sets = UnionFind::new(3);
		assert!(sets.union(0, 1));
		assert!(!sets.union(1, 0));
		assert!(!sets.union(2, 2));
	}

	#[test]
	fn numbers_the_sets_by_their_smallest_node() {
		let mut sets = UnionFind::new(6);
		sets.union(5, 1);
		sets.union(4, 2);
		sets.union(3, 4);
		assert_eq!(sets.labels(), [0, 1, 2, 2, 2, 1]);
	}

	#[test]
	fn unions_a_long_run_of_nodes_into_one_set() {
		let mut sets = UnionFind::new(200_000);
		for node in 1..200_000_u32 {
			sets.union(node - 1, node);
		}
		assert!(sets.labels().iter().all(|&label| label == 0));
	}

	#[test]
	fn handles_no_nodes() {
		let mut sets = UnionFind::new(0);
		assert!(sets.is_empty());
		assert!(sets.labels().is_empty());
	}
}
