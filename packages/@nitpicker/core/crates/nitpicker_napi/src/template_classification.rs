//! `TemplateClassificationRun`: the template classifier, driven from JS.
//!
//! JS reads the corpus (it lives in the archive's database) and hands it
//! over in batches: every page's signals first, then the HTML once or twice.
//! Each call that computes returns a promise and does its work on rayon's
//! thread pool, never on Node's main thread or libuv's small worker pool, so
//! JS keeps reading the next batch meanwhile. Calls must not overlap: the
//! run is a sequence (sampling decisions follow page order), so a second
//! call while one is running is rejected rather than queued.
//!
//! Progress events cross to JS on a threadsafe function, which does not
//! order them against the promise's settlement; each computing call
//! therefore resolves with the number of events it sent, so the JS wrapper
//! can wait for them before resolving its own promise.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use napi::bindgen_prelude::{Object, Uint8Array, Uint32Array};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, Result, Status};
use napi_derive::napi;
use nitpicker_template_cluster::{
	BlockingReason, Classification, ClassificationOutput, ContentRoot, Context, LandmarkType,
	PageInput, PageSignals, Progress, RunError, SampleReason, TEMPLATE_MEMORY_BUDGET,
};

/// One page's blocking signals.
#[napi(object)]
pub struct PageSignalsInput {
	pub paths: Vec<String>,
	pub stylesheet_hrefs: Vec<String>,
	/// `new URL(href).host` of each stylesheet href, `null` where it throws.
	pub stylesheet_hosts: Vec<Option<String>>,
	pub host: Option<String>,
}

/// A content-root hint as the crawler recorded it.
#[napi(object)]
pub struct ContentRootInput {
	pub tag_name: Option<String>,
	pub id: Option<String>,
	pub role: Option<String>,
	pub class_list: Option<Vec<String>>,
}

/// One page's HTML.
#[napi(object)]
pub struct PageHtmlInput {
	pub html: String,
	pub content_root: Option<ContentRootInput>,
}

/// A progress event (`phase` is `block-sampled`, `pass1-block-complete`,
/// `pass1b-assign` or `stage-b-start`).
#[napi(object)]
pub struct ClassificationProgress {
	pub phase: String,
	pub block_key: Option<String>,
	pub blocks_processed: Option<u32>,
	pub total_blocks: Option<u32>,
	pub pages_assigned: Option<u32>,
	pub pages_to_assign: Option<u32>,
	pub unit_count: Option<u32>,
	pub page_count: Option<u32>,
	pub pair_bytes: Option<f64>,
	pub budget: Option<f64>,
	/// `table-over-budget` or `pages-over-limit` (`block-sampled` only).
	pub reason: Option<String>,
}

/// A block clustered from a sample of its pages: its similarity table
/// exceeded the memory budget, or the blocks clustered whole would hold too
/// many pages.
#[napi(object)]
pub struct SampledBlockOutput {
	pub block_key: String,
	pub page_count: u32,
	pub pair_bytes: f64,
	/// `table-over-budget` or `pages-over-limit`.
	pub reason: String,
}

/// A block's blocking evidence, flattened: `distinctiveStylesheetHrefs` for
/// `kind: "css"`, `pathKey` for `"path"` and `"orphanMerge"`.
#[napi(object)]
pub struct BlockingEvidence {
	pub block_key: String,
	pub kind: String,
	pub distinctive_stylesheet_hrefs: Option<Vec<String>>,
	pub path_key: Option<String>,
}

/// One landmark type's profile in a cluster.
#[napi(object)]
pub struct LandmarkProfile {
	/// `header`, `footer`, `nav`, `aside`, `form` or `search`.
	pub r#type: String,
	pub presence_rate: f64,
	pub chrome_rate: f64,
	pub shell_tokens: Vec<String>,
	pub member_count_with_instance: u32,
}

/// One final cluster's reason.
#[napi(object)]
pub struct ClusterReasonOutput {
	pub cluster_key: String,
	pub member_count: u32,
	pub blocking: Vec<BlockingEvidence>,
	pub structural_core_tokens: Vec<String>,
	pub landmarks: Vec<LandmarkProfile>,
	pub sibling_cluster_keys: Vec<String>,
}

/// The classification's result.
#[napi(object)]
pub struct TemplateClassificationOutput {
	/// Every final cluster key.
	pub keys: Vec<String>,
	/// Each page's key, indexing `keys`.
	pub key_of_page: Uint32Array,
	/// One reason per final cluster.
	pub reasons: Vec<ClusterReasonOutput>,
	/// The blocks clustered from a sample, in block order.
	pub sampled_blocks: Vec<SampledBlockOutput>,
}

type ProgressCallback = ThreadsafeFunction<
	ClassificationProgress,
	napi::bindgen_prelude::Unknown<'static>,
	ClassificationProgress,
	Status,
	false,
	true,
>;

fn to_u32(value: usize) -> u32 {
	u32::try_from(value).expect("fewer than 2^32 entries")
}

/// Byte counts reach JS as numbers; 2^53 bytes (8 PiB) is far past any
/// similarity table, so the cast loses nothing.
#[allow(clippy::cast_precision_loss)]
fn to_f64(value: u64) -> f64 {
	value as f64
}

fn reason_name(reason: SampleReason) -> &'static str {
	match reason {
		SampleReason::TableOverBudget => "table-over-budget",
		SampleReason::PagesOverLimit => "pages-over-limit",
	}
}

fn landmark_name(kind: LandmarkType) -> &'static str {
	match kind {
		LandmarkType::Header => "header",
		LandmarkType::Footer => "footer",
		LandmarkType::Nav => "nav",
		LandmarkType::Aside => "aside",
		LandmarkType::Form => "form",
		LandmarkType::Search => "search",
	}
}

fn to_evidence(block_key: String, reason: BlockingReason) -> BlockingEvidence {
	match reason {
		BlockingReason::Css {
			distinctive_stylesheet_hrefs,
		} => BlockingEvidence {
			block_key,
			kind: "css".to_owned(),
			distinctive_stylesheet_hrefs: Some(distinctive_stylesheet_hrefs),
			path_key: None,
		},
		BlockingReason::Path { path_key } => BlockingEvidence {
			block_key,
			kind: "path".to_owned(),
			distinctive_stylesheet_hrefs: None,
			path_key: Some(path_key),
		},
		BlockingReason::OrphanMerge { path_key } => BlockingEvidence {
			block_key,
			kind: "orphanMerge".to_owned(),
			distinctive_stylesheet_hrefs: None,
			path_key: Some(path_key),
		},
	}
}

fn to_js_output(output: ClassificationOutput) -> TemplateClassificationOutput {
	TemplateClassificationOutput {
		keys: output.keys,
		key_of_page: output.key_of_page.into(),
		reasons: output
			.reasons
			.into_iter()
			.map(|(cluster_key, reason)| ClusterReasonOutput {
				cluster_key,
				member_count: to_u32(reason.member_count),
				blocking: reason
					.blocking
					.into_iter()
					.map(|(block_key, evidence)| to_evidence(block_key, evidence))
					.collect(),
				structural_core_tokens: reason.structural_core_tokens,
				landmarks: reason
					.landmarks
					.into_iter()
					.map(|(kind, profile)| LandmarkProfile {
						r#type: landmark_name(kind).to_owned(),
						presence_rate: profile.presence_rate,
						chrome_rate: profile.chrome_rate,
						shell_tokens: profile.shell_tokens,
						member_count_with_instance: to_u32(profile.member_count_with_instance),
					})
					.collect(),
				sibling_cluster_keys: reason.sibling_cluster_keys,
			})
			.collect(),
		sampled_blocks: output
			.sampled_blocks
			.into_iter()
			.map(|block| SampledBlockOutput {
				block_key: block.block_key,
				page_count: to_u32(block.page_count),
				pair_bytes: to_f64(block.pair_bytes),
				reason: reason_name(block.reason).to_owned(),
			})
			.collect(),
	}
}

const PRODUCED: &str = "the run already produced its output";

fn active(slot: &mut Option<Classification>) -> std::result::Result<&mut Classification, RunError> {
	slot.as_mut()
		.ok_or_else(|| RunError::Protocol(PRODUCED.to_owned()))
}

fn still_running() -> Error {
	Error::new(
		Status::GenericFailure,
		"a TemplateClassificationRun call is still running; await it before the next",
	)
}

/// The run, or a failure when an earlier call panicked while holding it.
fn lock(shared: &Shared) -> Result<MutexGuard<'_, Option<Classification>>> {
	shared
		.run
		.lock()
		.map_err(|_| Error::new(Status::GenericFailure, "the run's lock is poisoned"))
}

fn to_page_signals(page: PageSignalsInput) -> PageSignals {
	PageSignals {
		paths: page.paths,
		stylesheet_hrefs: page.stylesheet_hrefs,
		stylesheet_hosts: page.stylesheet_hosts,
		host: page.host,
	}
}

fn to_page_input(page: PageHtmlInput) -> PageInput {
	PageInput {
		html: page.html,
		content_root: page.content_root.map(|root| ContentRoot {
			tag_name: root.tag_name,
			id: root.id,
			role: root.role,
			class_list: root.class_list.unwrap_or_default(),
		}),
	}
}

fn to_napi_error(error: &RunError) -> Error {
	match error {
		RunError::Cancelled => {
			Error::new(Status::Cancelled, "template classification was cancelled")
		}
		RunError::Protocol(message) => Error::new(Status::InvalidArg, message.clone()),
	}
}

struct Shared {
	run: Mutex<Option<Classification>>,
	cancelled: AtomicBool,
	busy: AtomicBool,
	/// `None` once released (see [`release_progress`]).
	progress: Mutex<Option<ProgressCallback>>,
}

/// Lets go of the JS progress callback once no event can follow — the
/// output was taken, or the run cancelled. While held, the threadsafe
/// function keeps the callback (and whatever its closure reaches, possibly
/// the caller's run) from being collected; events already queued are still
/// delivered.
fn release_progress(shared: &Shared) {
	if let Ok(mut progress) = shared.progress.lock() {
		progress.take();
	}
}

/// One template classification run.
#[napi]
pub struct TemplateClassificationRun {
	shared: Arc<Shared>,
}

/// Clears the busy flag however the work ends.
struct BusyGuard(Arc<Shared>);

impl Drop for BusyGuard {
	fn drop(&mut self) {
		self.0.busy.store(false, Ordering::Release);
	}
}

#[napi]
impl TemplateClassificationRun {
	/// Starts a run, which first collects the pages' signals. A block whose
	/// Stage A similarity table would take more than `memory_budget` bytes
	/// (default [`TEMPLATE_MEMORY_BUDGET`]) is clustered from a sample.
	#[napi(constructor)]
	#[must_use]
	// A negative or fractional budget the caller passes saturates or truncates,
	// which is as good a budget as any.
	#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
	pub fn new(on_progress: Option<ProgressCallback>, memory_budget: Option<f64>) -> Self {
		let memory_budget = memory_budget.map_or(TEMPLATE_MEMORY_BUDGET, |bytes| bytes as u64);
		Self {
			shared: Arc::new(Shared {
				run: Mutex::new(Some(Classification::new(memory_budget))),
				cancelled: AtomicBool::new(false),
				busy: AtomicBool::new(false),
				progress: Mutex::new(on_progress),
			}),
		}
	}

	/// Runs `work` on rayon's pool and settles the returned promise with its
	/// result, turned into a JS value by `finish` on the JS thread together
	/// with the number of progress events the work sent.
	fn spawn<'env, T, D, F>(
		&self,
		env: &'env Env,
		work: F,
		finish: fn(T, u32) -> D,
	) -> Result<Object<'env>>
	where
		T: Send + 'static,
		D: napi::bindgen_prelude::ToNapiValue + 'static,
		F: FnOnce(&mut Option<Classification>, &Context) -> std::result::Result<T, RunError>
			+ Send
			+ 'static,
	{
		if self.shared.busy.swap(true, Ordering::AcqRel) {
			return Err(still_running());
		}
		let guard = BusyGuard(Arc::clone(&self.shared));
		let (deferred, promise) = env.create_deferred()?;
		let shared = Arc::clone(&self.shared);
		rayon::spawn(move || {
			let sent = AtomicU32::new(0);
			let outcome = catch_unwind(AssertUnwindSafe(|| {
				let report = |progress: Progress| {
					let Ok(callback) = shared.progress.lock() else {
						return;
					};
					if let Some(callback) = callback.as_ref() {
						let status = callback.call(
							to_js_progress(progress),
							ThreadsafeFunctionCallMode::NonBlocking,
						);
						// Only queued events reach JS, so only they are counted.
						if status == Status::Ok {
							sent.fetch_add(1, Ordering::Relaxed);
						}
					}
				};
				let context = Context {
					cancelled: &shared.cancelled,
					progress: &report,
				};
				let mut slot = lock(&shared)?;
				work(&mut slot, &context).map_err(|error| to_napi_error(&error))
			}));
			let sent = sent.load(Ordering::Relaxed);
			let produced = lock(&shared).is_ok_and(|run| run.is_none());
			if produced || shared.cancelled.load(Ordering::Relaxed) {
				release_progress(&shared);
			}
			// The call stays busy until the promise settles on the JS thread, not
			// merely until the work ends here: otherwise a quick call could free
			// the run before JS awaited it, and an overlapping call would slip in.
			deferred.resolve(move |_| {
				drop(guard);
				match outcome {
					Ok(Ok(value)) => Ok(finish(value, sent)),
					Ok(Err(error)) => Err(error),
					Err(_) => Err(Error::new(
						Status::GenericFailure,
						"template classification panicked",
					)),
				}
			});
		});
		Ok(promise)
	}

	/// Locks the run for a synchronous call, which must not overlap another.
	fn query(&self) -> Result<MutexGuard<'_, Option<Classification>>> {
		if self.shared.busy.load(Ordering::Acquire) {
			return Err(still_running());
		}
		lock(&self.shared)
	}

	/// Adds the next pages' signals, in corpus order. Synchronous: it only
	/// stores them (the conversion from JS happens on this thread anyway).
	#[napi]
	pub fn push_signals(&self, signals: Vec<PageSignalsInput>) -> Result<()> {
		let mut run = self.query()?;
		active(&mut run)
			.and_then(|run| run.push_signals(signals.into_iter().map(to_page_signals).collect()))
			.map_err(|error| to_napi_error(&error))
	}

	/// Splits the corpus into blocks (Pass 0) and starts reading the HTML.
	/// Resolves with the number of progress events sent.
	#[napi(ts_return_type = "Promise<number>")]
	pub fn block<'env>(&self, env: &'env Env) -> Result<Object<'env>> {
		self.spawn(
			env,
			|slot, context| active(slot)?.block(context),
			|(), sent| sent,
		)
	}

	/// Reads the next pages' HTML, in corpus order. Resolves with the number
	/// of progress events sent.
	#[napi(ts_return_type = "Promise<number>")]
	pub fn push_pages<'env>(
		&self,
		env: &'env Env,
		pages: Vec<PageHtmlInput>,
	) -> Result<Object<'env>> {
		let pages: Vec<PageInput> = pages.into_iter().map(to_page_input).collect();
		self.spawn(
			env,
			move |slot, context| active(slot)?.push_pages(pages, context),
			|(), sent| sent,
		)
	}

	/// Ends the first read of the HTML (the blocks clustered whole are
	/// clustered here). Resolves with the number of progress events sent.
	#[napi(ts_return_type = "Promise<number>")]
	pub fn finish_pages<'env>(&self, env: &'env Env) -> Result<Object<'env>> {
		self.spawn(
			env,
			|slot, context| active(slot)?.finish_pages(context),
			|(), sent| sent,
		)
	}

	/// Which pages the current read uses (`1`); the others may be sent with
	/// empty HTML.
	#[napi]
	pub fn page_mask(&self) -> Result<Uint8Array> {
		let run = self.query()?;
		let run = run
			.as_ref()
			.ok_or_else(|| to_napi_error(&RunError::Protocol(PRODUCED.to_owned())))?;
		Ok(run
			.page_mask()
			.map_err(|error| to_napi_error(&error))?
			.into_iter()
			.map(u8::from)
			.collect::<Vec<u8>>()
			.into())
	}

	/// Whether the run needs a second read to assign the pages outside the
	/// samples of its sampled blocks.
	#[napi]
	pub fn needs_assignment(&self) -> Result<bool> {
		Ok(self
			.query()?
			.as_ref()
			.is_some_and(Classification::needs_assignment))
	}

	/// Assigns the next pages of the second read, in corpus order. Resolves
	/// with the number of progress events sent.
	#[napi(ts_return_type = "Promise<number>")]
	pub fn push_assignment_pages<'env>(
		&self,
		env: &'env Env,
		pages: Vec<PageHtmlInput>,
	) -> Result<Object<'env>> {
		let pages: Vec<PageInput> = pages.into_iter().map(to_page_input).collect();
		self.spawn(
			env,
			move |slot, context| active(slot)?.push_assignment_pages(pages, context),
			|(), sent| sent,
		)
	}

	/// Merges the clusters across blocks and returns the result, with the
	/// number of progress events sent; the run cannot be used afterwards.
	#[napi(ts_return_type = "Promise<{ output: TemplateClassificationOutput; sent: number }>")]
	pub fn take_output<'env>(&self, env: &'env Env) -> Result<Object<'env>> {
		self.spawn(
			env,
			|slot, context| {
				let run = slot
					.take()
					.ok_or_else(|| RunError::Protocol(PRODUCED.to_owned()))?;
				run.into_output(context)
			},
			|output, sent| TakenOutput {
				output: to_js_output(output),
				sent,
			},
		)
	}

	/// Stops the running (and every later) call at its next page or block,
	/// and lets go of the progress callback.
	#[napi]
	pub fn cancel(&self) {
		self.shared.cancelled.store(true, Ordering::Relaxed);
		release_progress(&self.shared);
	}
}

/// What `takeOutput` resolves with.
#[napi(object)]
pub struct TakenOutput {
	pub output: TemplateClassificationOutput,
	pub sent: u32,
}

fn to_js_progress(progress: Progress) -> ClassificationProgress {
	let event = |phase: &str| ClassificationProgress {
		phase: phase.to_owned(),
		block_key: None,
		blocks_processed: None,
		total_blocks: None,
		pages_assigned: None,
		pages_to_assign: None,
		unit_count: None,
		page_count: None,
		pair_bytes: None,
		budget: None,
		reason: None,
	};
	match progress {
		Progress::BlockSampled {
			block_key,
			page_count,
			pair_bytes,
			budget,
			reason,
		} => ClassificationProgress {
			block_key: Some(block_key),
			page_count: Some(to_u32(page_count)),
			pair_bytes: Some(to_f64(pair_bytes)),
			budget: Some(to_f64(budget)),
			reason: Some(reason_name(reason).to_owned()),
			..event("block-sampled")
		},
		Progress::BlockComplete {
			block_key,
			blocks_processed,
			total_blocks,
		} => ClassificationProgress {
			block_key: Some(block_key),
			blocks_processed: Some(to_u32(blocks_processed)),
			total_blocks: Some(to_u32(total_blocks)),
			..event("pass1-block-complete")
		},
		Progress::Assigned {
			pages_assigned,
			pages_to_assign,
		} => ClassificationProgress {
			pages_assigned: Some(to_u32(pages_assigned)),
			pages_to_assign: Some(to_u32(pages_to_assign)),
			..event("pass1b-assign")
		},
		Progress::StageBStart { unit_count } => ClassificationProgress {
			unit_count: Some(to_u32(unit_count)),
			..event("stage-b-start")
		},
	}
}
