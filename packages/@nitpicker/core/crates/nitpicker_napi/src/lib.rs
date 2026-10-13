//! The only crate that depends on napi: a thin layer exposing the computation
//! crates to Node. Keeping napi out of the other crates lets them be tested
//! with plain `cargo test`, without a Node runtime.
//!
//! Every exported function uses `catch_unwind`, so a Rust panic reaches JS as
//! a thrown `Error` instead of aborting the whole Node process.

mod template_classification;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

/// Pages per block a streaming template classification run clusters (see
/// `template_classification`).
#[napi]
// A small constant (100); the cast cannot truncate.
#[allow(clippy::cast_possible_truncation)]
pub const TEMPLATE_BLOCK_SAMPLE_SIZE: u32 = nitpicker_template_cluster::BLOCK_SAMPLE_SIZE as u32;

/// Corpus size above which a template classification run streams (see
/// `template_classification`).
#[napi]
// A small constant (20,000); the cast cannot truncate.
#[allow(clippy::cast_possible_truncation)]
pub const TEMPLATE_CORPUS_INLINE_THRESHOLD: u32 =
	nitpicker_template_cluster::CORPUS_INLINE_THRESHOLD as u32;

/// Computes `page_meta.body_hash` for one HTML document.
///
/// Synchronous on purpose: it runs on the crawler's event handler once per
/// page, where a dedupe decision needs the result immediately, and a single
/// page is cheap enough that a worker hop would cost more than it saves.
#[napi(catch_unwind)]
#[must_use]
pub fn compute_body_hash(html: &[u8]) -> Buffer {
	nitpicker_html_scan::compute_body_hash(html).to_vec().into()
}
