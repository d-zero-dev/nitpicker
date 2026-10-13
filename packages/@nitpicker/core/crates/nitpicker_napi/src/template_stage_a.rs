//! `TemplateStageARun`: the template classifier's Stage A, driven from JS.
//!
//! JS reads the pages (they live in the archive's database) and hands them
//! over in batches; each call returns a promise and does its work on rayon's
//! thread pool, never on Node's main thread or libuv's small worker pool, so
//! JS keeps reading the next batch meanwhile. Calls must not overlap: the
//! run is a sequence (sampling decisions follow page order), so a second
//! call while one is running is rejected rather than queued.
//!
//! Progress events cross to JS on a threadsafe function, which does not
//! order them against the promise's settlement; each reading call therefore
//! resolves with the number of events it sent, so the JS wrapper can wait
//! for them before resolving its own promise.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use napi::bindgen_prelude::{Object, Uint8Array, Uint32Array};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, Result, Status};
use napi_derive::napi;
use nitpicker_template_cluster::{
	ContentRoot, Context, LandmarkType, Mode, Output, PageInput, Progress, Run, RunError,
	Vocabulary,
};
use rustc_hash::FxHashMap;

/// A content-root hint as the crawler recorded it.
#[napi(object)]
pub struct ContentRootInput {
	pub tag_name: Option<String>,
	pub id: Option<String>,
	pub role: Option<String>,
	pub class_list: Option<Vec<String>>,
}

/// One page.
#[napi(object)]
pub struct StageAPageInput {
	pub html: String,
	pub content_root: Option<ContentRootInput>,
}

/// A progress event (`phase` is `pass1-block-complete` or `pass1b-assign`).
#[napi(object)]
pub struct StageAProgress {
	pub phase: String,
	pub block_key: Option<String>,
	pub blocks_processed: Option<u32>,
	pub total_blocks: Option<u32>,
	pub pages_assigned: Option<u32>,
	pub pages_to_assign: Option<u32>,
}

/// One Stage B unit, its members' data packed into flat arrays: member `m`
/// owns `memberTokens[memberTokenOffsets[m]..memberTokenOffsets[m + 1]]`, and
/// so on for its landmark instances. Token values index `tokens` of
/// [`StageAOutput`].
#[napi(object)]
pub struct StageAUnit {
	pub key: u32,
	pub block: u32,
	pub member_page_indices: Uint32Array,
	pub member_token_offsets: Uint32Array,
	pub member_tokens: Uint32Array,
	pub member_instance_offsets: Uint32Array,
	pub instance_types: Uint8Array,
	pub instance_token_offsets: Uint32Array,
	pub instance_tokens: Uint32Array,
}

/// Stage A's result.
#[napi(object)]
pub struct StageAOutput {
	/// Every token the units mention, each once.
	pub tokens: Vec<String>,
	/// Every cluster key.
	pub keys: Vec<String>,
	/// Each page's key, indexing `keys`.
	pub key_of_page: Uint32Array,
	pub units: Vec<StageAUnit>,
}

type ProgressCallback = ThreadsafeFunction<
	StageAProgress,
	napi::bindgen_prelude::Unknown<'static>,
	StageAProgress,
	Status,
	false,
	true,
>;

/// A landmark type's code in `StageAUnit::instance_types`: its index in
/// `@nitpicker/archive`'s `ALL_LANDMARK_TYPES`, which decodes it.
fn landmark_code(kind: LandmarkType) -> u8 {
	match kind {
		LandmarkType::Header => 0,
		LandmarkType::Footer => 1,
		LandmarkType::Nav => 2,
		LandmarkType::Aside => 3,
		LandmarkType::Form => 4,
		LandmarkType::Search => 5,
	}
}

fn to_u32(value: usize) -> u32 {
	u32::try_from(value).expect("fewer than 2^32 entries")
}

/// [`StageAUnit`] before its arrays become JS typed arrays (which happens on
/// the JS thread).
struct PackedUnit {
	key: u32,
	block: u32,
	member_page_indices: Vec<u32>,
	member_token_offsets: Vec<u32>,
	member_tokens: Vec<u32>,
	member_instance_offsets: Vec<u32>,
	instance_types: Vec<u8>,
	instance_token_offsets: Vec<u32>,
	instance_tokens: Vec<u32>,
}

/// [`StageAOutput`] before conversion.
struct PackedOutput {
	tokens: Vec<String>,
	keys: Vec<String>,
	key_of_page: Vec<u32>,
	units: Vec<PackedUnit>,
}

impl PackedOutput {
	fn into_js(self) -> StageAOutput {
		StageAOutput {
			tokens: self.tokens,
			keys: self.keys,
			key_of_page: self.key_of_page.into(),
			units: self
				.units
				.into_iter()
				.map(|unit| StageAUnit {
					key: unit.key,
					block: unit.block,
					member_page_indices: unit.member_page_indices.into(),
					member_token_offsets: unit.member_token_offsets.into(),
					member_tokens: unit.member_tokens.into(),
					member_instance_offsets: unit.member_instance_offsets.into(),
					instance_types: unit.instance_types.into(),
					instance_token_offsets: unit.instance_token_offsets.into(),
					instance_tokens: unit.instance_tokens.into(),
				})
				.collect(),
		}
	}
}

/// Packs the output, numbering tokens in order of first mention so the
/// table is deterministic (interned ids depend on thread timing).
fn pack(output: Output, vocabulary: &Vocabulary) -> PackedOutput {
	let mut table: Vec<String> = Vec::new();
	let mut index_of: FxHashMap<u32, u32> = FxHashMap::default();
	let mut index = |id: u32| -> u32 {
		*index_of.entry(id).or_insert_with(|| {
			table.push(vocabulary.token(id).to_string());
			to_u32(table.len() - 1)
		})
	};
	let units = output
		.units
		.into_iter()
		.map(|unit| {
			let mut member_page_indices = Vec::with_capacity(unit.members.len());
			let mut member_token_offsets = vec![0];
			let mut member_tokens = Vec::new();
			let mut member_instance_offsets = vec![0];
			let mut instance_types = Vec::new();
			let mut instance_token_offsets = vec![0];
			let mut instance_tokens = Vec::new();
			for member in unit.members {
				member_page_indices.push(member.page_index);
				member_tokens.extend(member.tokens.into_iter().map(&mut index));
				member_token_offsets.push(to_u32(member_tokens.len()));
				for (kind, tokens) in member.instances {
					instance_types.push(landmark_code(kind));
					instance_tokens.extend(tokens.into_iter().map(&mut index));
					instance_token_offsets.push(to_u32(instance_tokens.len()));
				}
				member_instance_offsets.push(to_u32(instance_types.len()));
			}
			PackedUnit {
				key: unit.key,
				block: unit.block,
				member_page_indices,
				member_token_offsets,
				member_tokens,
				member_instance_offsets,
				instance_types,
				instance_token_offsets,
				instance_tokens,
			}
		})
		.collect();
	PackedOutput {
		tokens: table,
		keys: output.keys,
		key_of_page: output.key_of_page,
		units,
	}
}

const PRODUCED: &str = "the run already produced its output";

fn active(slot: &mut Option<Run>) -> std::result::Result<&mut Run, RunError> {
	slot.as_mut()
		.ok_or_else(|| RunError::Protocol(PRODUCED.to_owned()))
}

fn still_running() -> Error {
	Error::new(
		Status::GenericFailure,
		"a TemplateStageARun call is still running; await it before the next",
	)
}

/// The run, or a failure when an earlier call panicked while holding it.
fn lock(shared: &Shared) -> Result<MutexGuard<'_, Option<Run>>> {
	shared
		.run
		.lock()
		.map_err(|_| Error::new(Status::GenericFailure, "the run's lock is poisoned"))
}

fn to_page_input(page: StageAPageInput) -> PageInput {
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
	run: Mutex<Option<Run>>,
	cancelled: AtomicBool,
	busy: AtomicBool,
	progress: Option<ProgressCallback>,
}

/// Stage A of one classification run.
#[napi]
pub struct TemplateStageARun {
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
impl TemplateStageARun {
	/// Starts a run. `blockOfPage[i]` is page `i`'s index into `blockKeys`,
	/// whose order is the order blocks are clustered (and units emitted) in.
	#[napi(constructor)]
	// napi passes arguments by value; the typed array is only read.
	#[allow(clippy::needless_pass_by_value)]
	pub fn new(
		block_keys: Vec<String>,
		block_of_page: Uint32Array,
		streaming: bool,
		on_progress: Option<ProgressCallback>,
	) -> Result<Self> {
		let mode = if streaming {
			Mode::Streaming
		} else {
			Mode::InMemory
		};
		let run = Run::new(block_keys, block_of_page.to_vec(), mode)
			.map_err(|error| to_napi_error(&error))?;
		Ok(Self {
			shared: Arc::new(Shared {
				run: Mutex::new(Some(run)),
				cancelled: AtomicBool::new(false),
				busy: AtomicBool::new(false),
				progress: on_progress,
			}),
		})
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
		F: FnOnce(&mut Option<Run>, &Context) -> std::result::Result<T, RunError> + Send + 'static,
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
					if let Some(callback) = &shared.progress {
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

	/// Locks the run for a synchronous query, which must not overlap a call.
	fn query(&self) -> Result<MutexGuard<'_, Option<Run>>> {
		if self.shared.busy.load(Ordering::Acquire) {
			return Err(still_running());
		}
		lock(&self.shared)
	}

	/// Reads the next pages, in corpus order. Resolves with the number of
	/// progress events sent.
	#[napi(ts_return_type = "Promise<number>")]
	pub fn push_pages<'env>(
		&self,
		env: &'env Env,
		pages: Vec<StageAPageInput>,
	) -> Result<Object<'env>> {
		let pages: Vec<PageInput> = pages.into_iter().map(to_page_input).collect();
		self.spawn(
			env,
			move |slot, context| active(slot)?.push_pages(pages, context),
			|(), sent| sent,
		)
	}

	/// Ends the first read (an in-memory run clusters every block here).
	/// Resolves with the number of progress events sent.
	#[napi(ts_return_type = "Promise<number>")]
	pub fn finish_pages<'env>(&self, env: &'env Env) -> Result<Object<'env>> {
		self.spawn(
			env,
			|slot, context| active(slot)?.finish_pages(context),
			|(), sent| sent,
		)
	}

	/// Which pages the current read uses (`1`); the others may be sent
	/// with empty HTML.
	#[napi]
	pub fn page_mask(&self) -> Result<Uint8Array> {
		let run = self.query()?;
		let run = run
			.as_ref()
			.ok_or_else(|| to_napi_error(&RunError::Protocol(PRODUCED.to_owned())))?;
		Ok(run
			.page_mask()
			.into_iter()
			.map(u8::from)
			.collect::<Vec<u8>>()
			.into())
	}

	/// Whether a streaming run needs a second read to assign the pages
	/// outside its samples.
	#[napi]
	pub fn needs_assignment(&self) -> Result<bool> {
		Ok(self.query()?.as_ref().is_some_and(Run::needs_assignment))
	}

	/// Assigns the next pages of the second read, in corpus order. Resolves
	/// with the number of progress events sent.
	#[napi(ts_return_type = "Promise<number>")]
	pub fn push_assignment_pages<'env>(
		&self,
		env: &'env Env,
		pages: Vec<StageAPageInput>,
	) -> Result<Object<'env>> {
		let pages: Vec<PageInput> = pages.into_iter().map(to_page_input).collect();
		self.spawn(
			env,
			move |slot, context| active(slot)?.push_assignment_pages(pages, context),
			|(), sent| sent,
		)
	}

	/// The result; the run cannot be used afterwards.
	#[napi(ts_return_type = "Promise<StageAOutput>")]
	pub fn take_output<'env>(&self, env: &'env Env) -> Result<Object<'env>> {
		self.spawn(
			env,
			|slot, _| {
				let run = slot
					.take()
					.ok_or_else(|| RunError::Protocol(PRODUCED.to_owned()))?;
				let (output, vocabulary) = run.into_output()?;
				Ok(pack(output, &vocabulary))
			},
			|output, _| output.into_js(),
		)
	}

	/// Stops the running (and every later) call at its next page or block.
	#[napi]
	pub fn cancel(&self) {
		self.shared.cancelled.store(true, Ordering::Relaxed);
	}
}

fn to_js_progress(progress: Progress) -> StageAProgress {
	match progress {
		Progress::BlockComplete {
			block_key,
			blocks_processed,
			total_blocks,
		} => StageAProgress {
			phase: "pass1-block-complete".to_owned(),
			block_key: Some(block_key),
			blocks_processed: Some(to_u32(blocks_processed)),
			total_blocks: Some(to_u32(total_blocks)),
			pages_assigned: None,
			pages_to_assign: None,
		},
		Progress::Assigned {
			pages_assigned,
			pages_to_assign,
		} => StageAProgress {
			phase: "pass1b-assign".to_owned(),
			block_key: None,
			blocks_processed: None,
			total_blocks: None,
			pages_assigned: Some(to_u32(pages_assigned)),
			pages_to_assign: Some(to_u32(pages_to_assign)),
		},
		// Only a whole classification runs Stage B; a Stage A run never sends it.
		Progress::StageBStart { .. } => StageAProgress {
			phase: "stage-b-start".to_owned(),
			block_key: None,
			blocks_processed: None,
			total_blocks: None,
			pages_assigned: None,
			pages_to_assign: None,
		},
	}
}
