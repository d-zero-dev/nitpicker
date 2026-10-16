//! Connected components over integer ids, without keeping the edges.
//!
//! The viewer read model groups pages twice by their links or likeness: the
//! inventory pages that nothing in the crawled site links to
//! ([`IsolatedGraph`]), and the pages that are the same page under another
//! URL (`nitpicker_url_key`'s alias grouping, which builds on
//! [`UnionFind`]). Both read their edges from SQLite in batches, so the graph
//! is never held whole: an edge is unioned the moment it is read, and the
//! memory a run takes follows the number of nodes, not the number of edges.
//!
//! # What the result depends on
//!
//! The components a set of edges forms do not depend on the order of the
//! edges, or on how they were split into batches. The **numbering** of the
//! components ([`UnionFind::labels`]) depends on the order of the nodes only:
//! a component takes the next number the first time one of its nodes is met
//! in node order. Callers that persist the number (`component_id`) therefore
//! hand the nodes over in a fixed order (ascending page id).
//!
//! # Redirects and aliases
//!
//! An edge that points at a redirect source or an alias member counts as an
//! edge to the page it finally lands on ([`resolve_canonical`]). A chain
//! that never ends — it loops, or leads into a loop — has no destination,
//! and an edge to it is dropped rather than failing the whole computation.

#![forbid(unsafe_code)]

mod isolated_graph;
mod resolve_canonical;
mod union_find;

pub use isolated_graph::IsolatedGraph;
pub use resolve_canonical::resolve_canonical;
pub use union_find::UnionFind;
