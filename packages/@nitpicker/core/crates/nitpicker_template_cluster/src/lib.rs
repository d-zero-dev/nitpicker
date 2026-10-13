//! The page-template classifier (`Classification`): Pass 0 splits the
//! corpus into blocks by URL section and stylesheets, Stage A clusters each
//! block by DOM structure from the pages' HTML, and Stage B merges clusters
//! across blocks and explains each final cluster.
//!
//! The keys this computes are stored in archives, and every archive keeps
//! the keys it was classified with, so the computation is fixed result for
//! result (`@nitpicker/archive`'s golden records pin it). Hence the
//! JavaScript string rules in `js_string`, htmlparser2's quirks in
//! `nitpicker_html_parser`, and the order-sensitive tie-breaks of insertion-
//! ordered maps.
//!
//! Each candidate content depth is defined as a cut of the markup parsed
//! again; rather than parse once per depth, one parse of the landmark-free
//! markup is replayed with each depth's cut as skipped events, falling back
//! to a real cut-and-parse only where the two could differ (`skip_ranges`).
//! Token sets are integer sets over a run-wide interner, pages are read in
//! parallel, and each block's similarity table is filled in parallel.

#![forbid(unsafe_code)]

mod are_stage_a_separated;
mod assign_contained_clusters;
mod auto_cut_threshold;
mod blocking_reason;
mod build_cluster_reason;
mod classification;
mod collect_deep_spans;
mod complete_linkage_dendrogram;
mod compute_document_frequency;
mod content_root;
mod derive_comparison_sets;
mod derive_path_group_key;
mod derive_stylesheet_group_key;
mod detect_content_depth_cap;
mod excise;
mod extract_landmarks;
mod filter_first_party_stylesheet_hrefs;
mod filter_merges_by_cohesion;
mod filter_merges_by_stage_a_separation;
mod find_matching_elements;
mod hash_content;
mod interner;
mod is_chrome_landmark_instance;
mod is_genuine_close;
mod is_noise_class;
mod jaccard;
mod js_string;
mod l2_signature;
mod local_chrome;
mod merge_cross_block_clusters;
mod page;
mod page_signals;
mod parse_class_list;
mod pass0;
mod quorum_core;
mod reassign_orphan_block_keys;
mod reservoir_sample;
mod resolve_blocking_group_keys;
mod run;
mod seeded_random;
mod segment;
mod shape_token;
mod shell_quorum;
mod skip_ranges;
mod split_tokens_by_frequency;
mod stage_a;
mod stage_a_lineage;
mod stage_b;
mod token_view;
mod tokenize;
mod vocabulary;

pub use blocking_reason::BlockingReason;
pub use build_cluster_reason::LandmarkClusterProfile;
pub use classification::{CORPUS_INLINE_THRESHOLD, Classification, ClassificationOutput, Reason};
pub use content_root::ContentRoot;
pub use extract_landmarks::LandmarkType;
pub use page_signals::PageSignals;
pub use run::{
	BLOCK_SAMPLE_SIZE, Context, Mode, Output, PageInput, Progress, Run, RunError, Unit, UnitMember,
};
pub use vocabulary::Vocabulary;
