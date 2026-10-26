//! Where every asynchronous native call runs: one dedicated rayon pool behind
//! an admission gate.
//!
//! - The pool is the addon's own, not rayon's global one, so its size is a
//!   setting (`NITPICKER_NATIVE_THREADS`) and a parallel iterator started
//!   inside a job spreads over this pool only.
//! - The gate lets at most `NITPICKER_NATIVE_CONCURRENCY` (default 1) jobs run
//!   at a time. One call already fills every thread, so a second one running
//!   beside it adds no throughput, only another set of live documents and a
//!   slower answer for both. A call over the limit waits in a FIFO queue and is
//!   never refused — a valid request (an MCP client may send several at once)
//!   must not fail because another is running. Waiting holds no thread: a
//!   finished job starts the next queued one itself.
//!
//! A job that wants to be stoppable reads its own cancel flag when it starts
//! and while it runs (see `native_executor::NativeCancelToken`); a job
//! cancelled while queued therefore ends at once when its turn comes.
//!
//! Synchronous calls (`compute_url_sort_ranks`) use [`Executor::install`]:
//! they run on the pool but skip the gate, because queueing for a slot behind
//! whole calls would block the caller's thread (the event loop, on the CLI) for
//! as long as those calls run. They still wait until a pool thread takes the
//! work, which a thread does between the tasks of the running call (one
//! snapshot's decode and judge, one step of a template classification block);
//! with a one-thread pool that is the length of one such task.
//!
//! The pool swallows a panic that escapes a job instead of aborting the Node
//! process (rayon's default). Every job catches its own panic to reject its
//! promise; this is the last line of defence, and the gate's slot is released
//! either way.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use rayon::{ThreadPool, ThreadPoolBuilder};

/// The environment variable that sets the pool's thread count.
pub const THREADS_VARIABLE: &str = "NITPICKER_NATIVE_THREADS";

/// The environment variable that sets how many jobs run at once.
pub const CONCURRENCY_VARIABLE: &str = "NITPICKER_NATIVE_CONCURRENCY";

/// Jobs that run at once when [`CONCURRENCY_VARIABLE`] is not set.
pub const DEFAULT_CONCURRENCY: usize = 1;

/// What an [`Executor`] is built from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExecutorConfig {
	/// Threads of the pool; `None` leaves rayon's default (`RAYON_NUM_THREADS`,
	/// else the number of logical cores).
	pub threads: Option<usize>,
	/// Jobs that run at once, at least 1.
	pub concurrency: usize,
}

/// Reads one setting as a positive integer. `None` and the empty string mean
/// "not set".
fn parse_positive(name: &str, value: Option<&str>) -> Result<Option<usize>, String> {
	match value {
		None | Some("") => Ok(None),
		Some(text) => match text.parse::<usize>() {
			Ok(number) if number > 0 => Ok(Some(number)),
			_ => Err(format!(
				"Invalid {name}=\"{text}\": expected a positive integer"
			)),
		},
	}
}

/// Reads the settings from the values of [`THREADS_VARIABLE`] and
/// [`CONCURRENCY_VARIABLE`].
///
/// # Errors
///
/// A message naming the variable when a value is not a positive integer (a
/// bad value is refused rather than replaced by the default).
pub fn parse_config(
	threads: Option<&str>,
	concurrency: Option<&str>,
) -> Result<ExecutorConfig, String> {
	Ok(ExecutorConfig {
		threads: parse_positive(THREADS_VARIABLE, threads)?,
		concurrency: parse_positive(CONCURRENCY_VARIABLE, concurrency)?
			.unwrap_or(DEFAULT_CONCURRENCY),
	})
}

/// Reads one environment variable; a value that is not Unicode is reported as
/// invalid rather than treated as unset.
fn read_variable(name: &str) -> Result<Option<String>, String> {
	match std::env::var(name) {
		Ok(value) => Ok(Some(value)),
		Err(std::env::VarError::NotPresent) => Ok(None),
		Err(std::env::VarError::NotUnicode(_)) => {
			Err(format!("Invalid {name}: the value is not valid Unicode"))
		}
	}
}

/// A one-way flag a job reads to learn that its caller gave up. Clones share
/// the flag; a call that was given no token gets a fresh one nobody raises.
#[derive(Clone, Debug, Default)]
pub struct CancelFlag {
	raised: Arc<AtomicBool>,
}

impl CancelFlag {
	/// Raises the flag; it stays raised.
	pub fn cancel(&self) {
		self.raised.store(true, Ordering::Relaxed);
	}

	/// The flag as the computation crates read it.
	#[must_use]
	pub fn raised(&self) -> &AtomicBool {
		&self.raised
	}
}

type Job = Box<dyn FnOnce() + Send + 'static>;

struct Gate {
	running: usize,
	queue: VecDeque<Job>,
}

/// A rayon pool and the gate in front of it.
pub struct Executor {
	pool: ThreadPool,
	concurrency: usize,
	gate: Mutex<Gate>,
}

/// Hands the slot of a finished (or panicked) job to the next queued one.
struct SlotGuard(Arc<Executor>);

impl Drop for SlotGuard {
	fn drop(&mut self) {
		let next = {
			let mut gate = self.0.lock_gate();
			let next = gate.queue.pop_front();
			if next.is_none() {
				gate.running -= 1;
			}
			next
		};
		if let Some(job) = next {
			self.0.start(job);
		}
	}
}

impl Executor {
	/// Builds the pool.
	///
	/// # Errors
	///
	/// The pool could not be created (the OS refused the threads).
	pub fn new(config: ExecutorConfig) -> Result<Arc<Self>, String> {
		let mut builder = ThreadPoolBuilder::new()
			.thread_name(|index| format!("nitpicker-native-{index}"))
			.panic_handler(|_| {});
		if let Some(threads) = config.threads {
			builder = builder.num_threads(threads);
		}
		let pool = builder
			.build()
			.map_err(|error| format!("Could not start the native thread pool: {error}"))?;
		Ok(Arc::new(Self {
			pool,
			concurrency: config.concurrency.max(1),
			gate: Mutex::new(Gate {
				running: 0,
				queue: VecDeque::new(),
			}),
		}))
	}

	/// The process-wide executor, built from the environment on first use.
	///
	/// # Errors
	///
	/// A message naming the variable when a setting is invalid; every call
	/// after the first reports the same failure.
	pub fn shared() -> Result<&'static Arc<Self>, String> {
		static SHARED: OnceLock<Result<Arc<Executor>, String>> = OnceLock::new();
		SHARED
			.get_or_init(|| {
				let config = parse_config(
					read_variable(THREADS_VARIABLE)?.as_deref(),
					read_variable(CONCURRENCY_VARIABLE)?.as_deref(),
				)?;
				Self::new(config)
			})
			.as_ref()
			.map_err(Clone::clone)
	}

	fn lock_gate(&self) -> MutexGuard<'_, Gate> {
		// The gate's data is consistent between its statements, so a poisoned
		// lock (a panic elsewhere while holding it) is safe to keep using.
		self.gate.lock().unwrap_or_else(PoisonError::into_inner)
	}

	fn start(self: &Arc<Self>, job: Job) {
		let executor = Arc::clone(self);
		self.pool.spawn(move || {
			let _slot = SlotGuard(executor);
			job();
		});
	}

	/// Runs `job` on the pool once a slot is free, behind the jobs already
	/// waiting.
	pub fn submit(self: &Arc<Self>, job: impl FnOnce() + Send + 'static) {
		let job: Job = Box::new(job);
		{
			let mut gate = self.lock_gate();
			if gate.running >= self.concurrency {
				gate.queue.push_back(job);
				return;
			}
			gate.running += 1;
		}
		self.start(job);
	}

	/// Runs `work` on the pool and returns its result, blocking the caller
	/// until a pool thread has run it. It does not wait for a slot of the
	/// concurrency limit (see the module docs).
	pub fn install<R: Send>(&self, work: impl FnOnce() -> R + Send) -> R {
		self.pool.install(work)
	}
}

#[cfg(test)]
mod tests {
	use std::sync::atomic::Ordering;
	use std::sync::mpsc::{Sender, channel};
	use std::sync::{Arc, Mutex};
	use std::time::Duration;

	use super::{CancelFlag, DEFAULT_CONCURRENCY, Executor, ExecutorConfig, parse_config};

	const PATIENCE: Duration = Duration::from_secs(10);
	const LONG_ENOUGH_TO_SEE_NOTHING: Duration = Duration::from_millis(150);

	fn executor(threads: usize, concurrency: usize) -> Arc<Executor> {
		Executor::new(ExecutorConfig {
			threads: Some(threads),
			concurrency,
		})
		.unwrap()
	}

	/// A job that announces itself, then waits to be released.
	fn gated_job(started: Sender<usize>, id: usize) -> (impl FnOnce() + Send, Sender<()>) {
		let (release, wait) = channel::<()>();
		let job = move || {
			started.send(id).unwrap();
			let _ = wait.recv_timeout(PATIENCE);
		};
		(job, release)
	}

	#[test]
	fn reads_unset_and_empty_settings_as_defaults() {
		let expected = ExecutorConfig {
			threads: None,
			concurrency: DEFAULT_CONCURRENCY,
		};
		assert_eq!(parse_config(None, None), Ok(expected));
		assert_eq!(parse_config(Some(""), Some("")), Ok(expected));
	}

	#[test]
	fn reads_positive_integers() {
		assert_eq!(
			parse_config(Some("4"), Some("2")),
			Ok(ExecutorConfig {
				threads: Some(4),
				concurrency: 2,
			})
		);
	}

	#[test]
	fn refuses_a_setting_that_is_not_a_positive_integer() {
		for bad in ["0", "-1", "lots", "1.5", " 2"] {
			let threads = parse_config(Some(bad), None).unwrap_err();
			assert!(threads.contains("NITPICKER_NATIVE_THREADS"), "{threads}");
			assert!(threads.contains(bad), "{threads}");
			let concurrency = parse_config(None, Some(bad)).unwrap_err();
			assert!(
				concurrency.contains("NITPICKER_NATIVE_CONCURRENCY"),
				"{concurrency}"
			);
		}
	}

	#[test]
	fn a_second_job_waits_for_the_first_when_one_runs_at_a_time() {
		let executor = executor(2, 1);
		let (started, started_rx) = channel();
		let (first, release_first) = gated_job(started.clone(), 1);
		let (second, release_second) = gated_job(started, 2);
		executor.submit(first);
		executor.submit(second);

		assert_eq!(started_rx.recv_timeout(PATIENCE), Ok(1));
		assert!(started_rx.recv_timeout(LONG_ENOUGH_TO_SEE_NOTHING).is_err());

		release_first.send(()).unwrap();
		assert_eq!(started_rx.recv_timeout(PATIENCE), Ok(2));
		release_second.send(()).unwrap();
	}

	#[test]
	fn runs_as_many_jobs_at_once_as_the_concurrency_allows() {
		let executor = executor(4, 2);
		let (started, started_rx) = channel();
		let (first, release_first) = gated_job(started.clone(), 1);
		let (second, release_second) = gated_job(started.clone(), 2);
		let (third, release_third) = gated_job(started, 3);
		executor.submit(first);
		executor.submit(second);
		executor.submit(third);

		let mut running = vec![
			started_rx.recv_timeout(PATIENCE).unwrap(),
			started_rx.recv_timeout(PATIENCE).unwrap(),
		];
		running.sort_unstable();
		assert_eq!(running, [1, 2]);
		assert!(started_rx.recv_timeout(LONG_ENOUGH_TO_SEE_NOTHING).is_err());

		release_first.send(()).unwrap();
		assert_eq!(started_rx.recv_timeout(PATIENCE), Ok(3));
		release_second.send(()).unwrap();
		release_third.send(()).unwrap();
	}

	#[test]
	fn runs_waiting_jobs_in_the_order_they_were_submitted() {
		let executor = executor(4, 1);
		let order = Arc::new(Mutex::new(Vec::new()));
		let (done, done_rx) = channel();
		for id in 0..50 {
			let order = Arc::clone(&order);
			let done = done.clone();
			executor.submit(move || {
				order.lock().unwrap().push(id);
				done.send(()).unwrap();
			});
		}
		for _ in 0..50 {
			done_rx.recv_timeout(PATIENCE).unwrap();
		}
		assert_eq!(*order.lock().unwrap(), (0..50).collect::<Vec<_>>());
	}

	#[test]
	fn a_panicking_job_still_hands_its_slot_on() {
		let executor = executor(2, 1);
		executor.submit(|| panic!("a job that escaped its own catch_unwind"));
		let (done, done_rx) = channel();
		executor.submit(move || done.send(()).unwrap());
		assert!(done_rx.recv_timeout(PATIENCE).is_ok());
	}

	#[test]
	fn a_job_spreads_its_parallel_work_over_the_dedicated_pool() {
		let executor = executor(3, 1);
		let (seen, seen_rx) = channel();
		executor.submit(move || seen.send(rayon::current_num_threads()).unwrap());
		assert_eq!(seen_rx.recv_timeout(PATIENCE), Ok(3));
	}

	#[test]
	fn install_runs_on_the_pool_without_waiting_for_a_slot() {
		let executor = executor(2, 1);
		let (started, started_rx) = channel();
		let (busy, release) = gated_job(started, 1);
		executor.submit(busy);
		assert_eq!(started_rx.recv_timeout(PATIENCE), Ok(1));

		assert_eq!(executor.install(rayon::current_num_threads), 2);
		release.send(()).unwrap();
	}

	#[test]
	fn a_flag_starts_down_and_stays_up_once_raised() {
		let flag = CancelFlag::default();
		assert!(!flag.raised().load(Ordering::Relaxed));
		flag.cancel();
		flag.cancel();
		assert!(flag.raised().load(Ordering::Relaxed));
	}

	#[test]
	fn clones_share_one_flag_and_separate_flags_do_not() {
		let flag = CancelFlag::default();
		let clone = flag.clone();
		let other = CancelFlag::default();
		clone.cancel();
		assert!(flag.raised().load(Ordering::Relaxed));
		assert!(!other.raised().load(Ordering::Relaxed));
	}
}
