//! Stage A of the page-template classifier: from each page's HTML to the
//! structural clusters of its Pass-0 block.
//!
//! The keys this computes are stored, and they were first computed by a
//! JavaScript engine (`@nitpicker/archive`'s `template-classification`); the
//! port reproduces it result for result. Hence the JavaScript string rules in
//! `js_string`, htmlparser2's quirks in `nitpicker_html_parser`, and the
//! order-sensitive tie-breaks kept wherever the original iterated a `Map`.
//!
//! What it does differently is cost. The original re-parsed every page once
//! per candidate content depth (cut the markup, parse again); here one parse
//! of the landmark-free markup is replayed with each depth's cut as skipped
//! events, falling back to a real cut-and-parse only where the two could
//! differ (`skip_ranges`). Token sets are integer sets over a run-wide
//! interner, pages are read in parallel, and each block's similarity table
//! is filled in parallel.

#![forbid(unsafe_code)]

mod assign_contained_clusters;
mod auto_cut_threshold;
mod collect_deep_spans;
mod complete_linkage_dendrogram;
mod content_root;
mod derive_comparison_sets;
mod detect_content_depth_cap;
mod excise;
mod extract_landmarks;
mod find_matching_elements;
mod hash_content;
mod interner;
mod is_genuine_close;
mod is_noise_class;
mod jaccard;
mod js_string;
mod local_chrome;
mod page;
mod parity_probe;
mod parse_class_list;
mod run;
mod seeded_random;
mod segment;
mod skip_ranges;
mod stage_a;
mod tokenize;
mod vocabulary;

pub use content_root::ContentRoot;
pub use extract_landmarks::LandmarkType;
pub use parity_probe::parity_probe;
pub use run::{
	BLOCK_SAMPLE_SIZE, Context, Mode, Output, PageInput, Progress, Run, RunError, Unit, UnitMember,
};
pub use vocabulary::Vocabulary;
