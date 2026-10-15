//! The only crate that depends on napi: a thin layer exposing the computation
//! crates to Node. Keeping napi out of the other crates lets them be tested
//! with plain `cargo test`, without a Node runtime.
//!
//! Every exported function uses `catch_unwind`, so a Rust panic reaches JS as
//! a thrown `Error` instead of aborting the whole Node process.

mod template_classification;

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi::{Error, Result, Status};
use napi_derive::napi;

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
/// on a worker thread, and it spends its time on rayon's pool.
///
/// # Errors
///
/// `InvalidArg` when `offsets` does not start at 0, does not ascend, runs
/// past `urls` or stops short of its end, or when a URL is not valid UTF-8.
#[napi(catch_unwind)]
pub fn compute_url_sort_ranks(urls: &[u8], offsets: &[u32]) -> Result<Uint32Array> {
	let invalid = |reason: &str| Error::new(Status::InvalidArg, reason.to_owned());
	if offsets.first() != Some(&0) {
		return Err(invalid("offsets must start at 0"));
	}
	let mut slices = Vec::with_capacity(offsets.len() - 1);
	for pair in offsets.windows(2) {
		let (start, end) = (pair[0] as usize, pair[1] as usize);
		if start > end || end > urls.len() {
			return Err(invalid("offsets must ascend and stay within the URL bytes"));
		}
		slices.push(
			std::str::from_utf8(&urls[start..end])
				.map_err(|_| invalid("every URL must be valid UTF-8"))?,
		);
	}
	if offsets.last().map(|&end| end as usize) != Some(urls.len()) {
		return Err(invalid("offsets must end at the length of the URL bytes"));
	}
	Ok(Uint32Array::new(nitpicker_url_key::sort_ranks(&slices)))
}
