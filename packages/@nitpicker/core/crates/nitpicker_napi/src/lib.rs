//! The only crate that depends on napi: a thin layer exposing the computation
//! crates to Node. Keeping napi out of the other crates lets them be tested
//! with plain `cargo test`, without a Node runtime.
//!
//! Every exported function uses `catch_unwind`, so a Rust panic reaches JS as
//! a thrown `Error` instead of aborting the whole Node process.

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

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
