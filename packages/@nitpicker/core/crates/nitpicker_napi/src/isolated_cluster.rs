//! `IsolatedClusterRun`: the connected components of the isolated pages,
//! driven from JS.
//!
//! JS reads the candidates and the redirect/alias hops once, then streams the
//! page's link edges in batches as SQLite returns them; no edge is kept, so
//! the memory follows the number of pages. Every call is synchronous: a batch
//! of tens of thousands of edges unions in milliseconds, and the read model
//! build already runs on a worker thread.

use napi::bindgen_prelude::Uint32Array;
use napi::{Error, Result, Status};
use napi_derive::napi;
use nitpicker_union_find::IsolatedGraph;

/// Reads `[a0, b0, a1, b1, ...]` as pairs.
fn pairs(values: &[u32], what: &str) -> Result<Vec<(u32, u32)>> {
	if !values.len().is_multiple_of(2) {
		return Err(Error::new(
			Status::InvalidArg,
			format!("{what} must hold an even number of ids"),
		));
	}
	let (chunks, _) = values.as_chunks::<2>();
	Ok(chunks.iter().map(|&[a, b]| (a, b)).collect())
}

/// The components of the candidates the link edges join.
#[napi]
pub struct IsolatedClusterRun {
	graph: IsolatedGraph,
}

#[napi]
impl IsolatedClusterRun {
	/// Starts with `candidate_ids` (the order the components are numbered in:
	/// ascending page id) each alone, and `redirects` the `[source, destination,
	/// ...]` redirect and alias hops of the whole archive.
	///
	/// # Errors
	///
	/// `InvalidArg` when `redirects` holds an odd number of ids.
	#[napi(constructor, catch_unwind)]
	pub fn new(candidate_ids: &[u32], redirects: &[u32]) -> Result<Self> {
		Ok(Self {
			graph: IsolatedGraph::new(candidate_ids, &pairs(redirects, "redirects")?),
		})
	}

	/// Joins the pages of a batch of `[page, href, ...]` link edges, in any
	/// order and batch size.
	///
	/// # Errors
	///
	/// `InvalidArg` when `edges` holds an odd number of ids.
	#[napi(catch_unwind)]
	pub fn union_edges(&mut self, edges: &[u32]) -> Result<()> {
		self.graph.add_edges(&pairs(edges, "edges")?);
		Ok(())
	}

	/// For each candidate, the number of its component, counted in order of
	/// first appearance.
	#[napi(catch_unwind)]
	pub fn labels(&mut self) -> Uint32Array {
		Uint32Array::new(self.graph.labels())
	}
}
