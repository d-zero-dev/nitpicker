//! `query search-html`'s matching (`nitpicker_html_scan`) as JS calls it.
//!
//! JS decides whether the pattern is a literal or `/…/flags`, validates the
//! flags and reads the stored snapshots from the archive's database; the
//! pattern is compiled here (once per call), and a batch is decoded (zstd),
//! read as UTF-8 and searched on the addon's thread pool (`executor`). The call
//! returns a promise, so neither Node's main thread nor libuv's small worker
//! pool is held.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Mutex, PoisonError};

use napi::bindgen_prelude::{Object, Uint8Array};
use napi::{Env, Error, Result, Status};
use napi_derive::napi;
use nitpicker_html_scan::{
	RegexFlags, ScanFailure, SearchKind, SearchPattern, StoredSnapshot, compile_search_pattern,
	judge_snapshots, search_html,
};

use crate::native_executor::{NativeCancelToken, cancelled_error, shared_executor};
use crate::slice_by_offsets::slice_by_offsets;
use crate::snapshot_codecs::to_snapshot_codecs;

/// A search pattern, already split into text and flags by JS.
// The shape of the JS object, which carries one boolean per flag.
#[allow(clippy::struct_excessive_bools)]
#[napi(object)]
pub struct SearchPatternInput {
	/// The literal text, or the regular expression's source.
	pub source: String,
	/// Match `source` as plain text.
	pub literal: bool,
	/// `i`.
	pub ignore_case: bool,
	/// `m`.
	pub multi_line: bool,
	/// `s`.
	pub dot_all: bool,
}

/// What a search found in one document.
#[napi(object)]
pub struct SearchOutcomeOutput {
	pub match_count: u32,
	/// Empty when `match_count` is 0.
	pub snippet: String,
}

/// What a search found in each snapshot of a batch.
#[napi(object)]
pub struct SearchSnapshotsOutput {
	/// One count per snapshot, in order.
	pub match_counts: Vec<u32>,
	/// One snippet per snapshot, in order; empty where there is no match.
	pub snippets: Vec<String>,
}

fn to_pattern(input: SearchPatternInput) -> SearchPattern {
	SearchPattern {
		source: input.source,
		kind: if input.literal {
			SearchKind::Literal
		} else {
			SearchKind::Regex(RegexFlags {
				ignore_case: input.ignore_case,
				multi_line: input.multi_line,
				dot_matches_new_line: input.dot_all,
			})
		},
	}
}

/// The last pattern compiled, with its regex. `searchHtml` calls the batch
/// search once per batch with the same pattern, and compiling a large Unicode
/// pattern is not free, so a batch reuses the previous call's regex. One entry
/// is enough for one search at a time; searches with different patterns running
/// at once (several archives behind one MCP server) evict each other and just
/// compile again.
static LAST_COMPILED: Mutex<Option<(SearchPattern, regex::Regex)>> = Mutex::new(None);

fn compile(input: SearchPatternInput) -> Result<regex::Regex> {
	let pattern = to_pattern(input);
	{
		let last = LAST_COMPILED.lock().unwrap_or_else(PoisonError::into_inner);
		if let Some((cached, regex)) = last.as_ref()
			&& *cached == pattern
		{
			return Ok(regex.clone());
		}
	}
	// Compiled outside the lock: a slow Unicode compile must not hold up a
	// search that already has its regex.
	let regex = compile_search_pattern(&pattern)
		.map_err(|error| Error::new(Status::InvalidArg, error.to_string()))?;
	*LAST_COMPILED.lock().unwrap_or_else(PoisonError::into_inner) = Some((pattern, regex.clone()));
	Ok(regex)
}

/// Compiles a search pattern and reports whether it matches the empty
/// string (which `search-html` rejects: it would match everywhere).
///
/// # Errors
///
/// `InvalidArg`, with the regex engine's message, when the pattern is not
/// valid or uses a construct the engine does not support (backreferences,
/// look-around), or compiles to more than the engine's size limit.
#[napi(catch_unwind)]
pub fn validate_search_pattern(pattern: SearchPatternInput) -> Result<bool> {
	Ok(compile(pattern)?.is_match(""))
}

/// Searches one document (UTF-8).
///
/// Synchronous: one document is cheap, and this is the entry the tests use.
///
/// # Errors
///
/// `InvalidArg` when the pattern cannot be compiled (see
/// [`validate_search_pattern`]).
#[napi(catch_unwind)]
pub fn search_html_document(
	pattern: SearchPatternInput,
	html: &[u8],
	snippet_length: u32,
) -> Result<SearchOutcomeOutput> {
	let regex = compile(pattern)?;
	let text = String::from_utf8_lossy(html);
	let outcome = search_html(&regex, &text, snippet_length as usize);
	Ok(SearchOutcomeOutput {
		match_count: outcome.match_count,
		snippet: outcome.snippet,
	})
}

/// Searches a batch of stored snapshots.
///
/// `bodies` holds the stored bytes back to back, `offsets` the `n + 1`
/// positions that cut it into `n` snapshots, and `codecs` one byte per
/// snapshot: `0` stored as they are, `1` zstd. A zstd snapshot may
/// decompress to at most `max_decoded_bytes`.
///
/// The work runs on the addon's thread pool (`executor`) after this call
/// returns — behind any call already running when the concurrency limit is
/// reached — and reads `bodies` in place: the caller must not write to that
/// buffer until the promise settles (the JS wrapper packs a fresh one for
/// every call).
///
/// `cancel_token`, once raised, stops the search at the next snapshot or
/// within the next mebibyte of a decompression under way (a call still
/// queued ends when its turn comes) and rejects with code `Cancelled`.
///
/// # Errors
///
/// `InvalidArg` when the pattern cannot be compiled, the offsets or a codec
/// are malformed, or an executor setting is invalid. The promise rejects when
/// a snapshot cannot be decoded (corrupt, or past `max_decoded_bytes`), when
/// the call was cancelled, or when searching panicked; a snapshot is never
/// silently reported as "no match".
// The arguments are the JS call's, one per buffer the batch crosses as.
#[allow(clippy::too_many_arguments)]
#[napi(ts_return_type = "Promise<SearchSnapshotsOutput>")]
pub fn search_html_snapshots<'env>(
	env: &'env Env,
	pattern: SearchPatternInput,
	snippet_length: u32,
	bodies: Uint8Array,
	offsets: &[u32],
	codecs: &[u8],
	max_decoded_bytes: u32,
	cancel_token: Option<&NativeCancelToken>,
) -> Result<Object<'env>> {
	let executor = shared_executor()?;
	let cancelled = NativeCancelToken::flag_of(cancel_token);
	let regex = compile(pattern)?;
	let codecs = to_snapshot_codecs(codecs)?;
	let cut = slice_by_offsets(&bodies, offsets)?;
	if cut.len() != codecs.len() {
		return Err(Error::new(
			Status::InvalidArg,
			"every snapshot needs exactly one codec".to_owned(),
		));
	}
	let ranges: Vec<std::ops::Range<usize>> = offsets
		.windows(2)
		.map(|pair| pair[0] as usize..pair[1] as usize)
		.collect();

	let (deferred, promise) = env.create_deferred()?;
	executor.submit(move || {
		let outcome = catch_unwind(AssertUnwindSafe(|| {
			let snapshots: Vec<StoredSnapshot> = ranges
				.into_iter()
				.zip(&codecs)
				.map(|(range, &codec)| StoredSnapshot {
					body: &bodies[range],
					codec,
				})
				.collect();
			judge_snapshots(
				&snapshots,
				max_decoded_bytes as usize,
				cancelled.raised(),
				|text| search_html(&regex, text, snippet_length as usize),
			)
		}));
		deferred.resolve(move |_| match outcome {
			Ok(Ok(outcomes)) => {
				let mut match_counts = Vec::with_capacity(outcomes.len());
				let mut snippets = Vec::with_capacity(outcomes.len());
				for outcome in outcomes {
					match_counts.push(outcome.match_count);
					snippets.push(outcome.snippet);
				}
				Ok(SearchSnapshotsOutput {
					match_counts,
					snippets,
				})
			}
			Ok(Err(ScanFailure::Cancelled)) => Err(cancelled_error("search-html matching")),
			Ok(Err(error)) => Err(Error::new(Status::GenericFailure, error.to_string())),
			Err(_) => Err(Error::new(
				Status::GenericFailure,
				"search-html matching panicked",
			)),
		});
	});
	Ok(promise)
}
