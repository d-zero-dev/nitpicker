//! The only crate that depends on napi: a thin layer exposing the computation
//! crates to Node. Keeping napi out of the other crates lets them be tested
//! with plain `cargo test`, without a Node runtime.
//!
//! Every synchronous function that computes, and every method of
//! `IsolatedClusterRun`, uses `catch_unwind`, so a Rust panic reaches JS as a
//! thrown `Error` instead of aborting the whole Node process. The asynchronous
//! calls (`match_selector_snapshots`, `search_html_snapshots`, every computing
//! method of `TemplateClassificationRun`) go through `executor`, which owns the
//! thread pool, the limit on calls running at once and the queue behind it;
//! each catches a panic inside the job it hands over and rejects its promise.
//! `NativeCancelToken` only flips a flag and cannot panic.

// The exported functions count as unused in the test build, where the addon
// registration that calls them is compiled out.
#[cfg_attr(test, allow(dead_code))]
mod alias;
mod executor;
mod isolated_cluster;
#[cfg_attr(test, allow(dead_code))]
mod match_selector;
#[cfg_attr(test, allow(dead_code))]
mod native_executor;
#[cfg_attr(test, allow(dead_code))]
mod search_html;
mod slice_by_offsets;
mod snapshot_codecs;
#[cfg_attr(test, allow(dead_code))]
mod tech_detect;
mod template_classification;

use napi::Result;
use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi_derive::napi;

use crate::native_executor::shared_executor;
use crate::slice_by_offsets::slice_utf8_by_offsets;

/// Pages per sampled block a template classification run clusters (see
/// `template_classification`).
#[napi]
// A small constant (100); the cast cannot truncate.
#[allow(clippy::cast_possible_truncation)]
pub const TEMPLATE_BLOCK_SAMPLE_SIZE: u32 = nitpicker_template_cluster::BLOCK_SAMPLE_SIZE as u32;

/// Pages of blocks clustered whole a template classification run holds at
/// once, at most (see `template_classification`).
#[napi]
// A small constant (20,000); the cast cannot truncate.
#[allow(clippy::cast_possible_truncation)]
pub const TEMPLATE_EXACT_PAGE_LIMIT: u32 = nitpicker_template_cluster::EXACT_PAGE_LIMIT as u32;

/// Default bytes a block's similarity table may take before a template
/// classification run clusters the block from a sample (see
/// `template_classification`).
#[napi]
// 512 MiB, far below 2^53; the cast is exact.
#[allow(clippy::cast_precision_loss)]
pub const TEMPLATE_MEMORY_BUDGET: f64 = nitpicker_template_cluster::TEMPLATE_MEMORY_BUDGET as f64;

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

/// Ranks URLs in natural URL order (`nitpicker_url_key`).
///
/// `urls` holds the URLs back to back as UTF-8 and `offsets` the `n + 1`
/// byte positions that cut it into `n` URLs (`offsets[i]..offsets[i + 1]`),
/// so a million URLs cross the boundary as two buffers, not a million
/// strings. Returns, per input position, the rank that URL takes.
///
/// Synchronous: it is called from the read model build, which already runs
/// on a worker thread. It spends its time on the addon's pool (the thread
/// count setting applies) but does not wait for a slot of the concurrency
/// limit: queueing behind whole calls would block the caller's thread. It
/// still waits for a free pool thread (see `executor`).
///
/// # Errors
///
/// `InvalidArg` when `offsets` does not start at 0, does not ascend, runs
/// past `urls` or stops short of its end, when a URL is not valid UTF-8, or
/// when an executor setting is invalid.
#[napi(catch_unwind)]
pub fn compute_url_sort_ranks(urls: &[u8], offsets: &[u32]) -> Result<Uint32Array> {
	let executor = shared_executor()?;
	let slices = slice_utf8_by_offsets(urls, offsets)?;
	Ok(Uint32Array::new(
		executor.install(|| nitpicker_url_key::sort_ranks(&slices)),
	))
}
