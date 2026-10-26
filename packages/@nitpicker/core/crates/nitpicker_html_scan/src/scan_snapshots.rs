use std::borrow::Cow;
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::{IndexedParallelIterator, IntoParallelRefIterator, ParallelIterator};

use crate::html_matches_selector::{HtmlMatchOutcome, html_matches_selector};
use crate::selector_plan::SelectorPlan;

/// How a stored snapshot's bytes are encoded (`page_html_blobs.codec`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotCodec {
	/// Stored as they are.
	None,
	/// Compressed as zstd frames.
	Zstd,
}

/// One stored HTML snapshot.
#[derive(Clone, Copy, Debug)]
pub struct StoredSnapshot<'a> {
	/// The stored bytes.
	pub body: &'a [u8],
	/// How `body` is encoded.
	pub codec: SnapshotCodec,
}

/// A snapshot could not be decoded.
#[derive(Debug)]
pub struct ScanError {
	/// Which snapshot of the batch (0-based).
	pub index: usize,
	/// Why decoding failed.
	pub reason: String,
}

impl fmt::Display for ScanError {
	fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(
			formatter,
			"snapshot {} could not be decoded: {}",
			self.index, self.reason
		)
	}
}

impl std::error::Error for ScanError {}

/// Why a scan stopped before judging every snapshot.
#[derive(Debug)]
pub enum ScanFailure {
	/// A snapshot's zstd data is corrupt.
	Undecodable(ScanError),
	/// The caller raised the cancel flag.
	Cancelled,
}

impl fmt::Display for ScanFailure {
	fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Undecodable(error) => error.fmt(formatter),
			Self::Cancelled => formatter.write_str("the scan was cancelled"),
		}
	}
}

impl std::error::Error for ScanFailure {}

/// Decodes every snapshot of a batch and reads each with `judge`, in parallel
/// on rayon's pool, returning one result per snapshot in input order.
///
/// Each snapshot is decoded, judged and dropped by the task that took it, so
/// no more decoded documents are alive than there are threads. A document is
/// read as UTF-8 with every invalid sequence replaced by U+FFFD, the way
/// `Buffer.prototype.toString('utf8')` reads it.
///
/// `cancelled` is read before each snapshot is decoded: once it is raised,
/// the snapshots not yet started are skipped, and the scan fails with
/// [`ScanFailure::Cancelled`] (a snapshot already being judged finishes first).
///
/// # Errors
///
/// [`ScanFailure::Cancelled`] when a snapshot found the flag raised before it
/// started; otherwise the first snapshot (by position) whose zstd data is
/// corrupt. A snapshot that cannot be decoded is never judged "no match": the
/// scan has failed.
pub fn judge_snapshots<T, F>(
	snapshots: &[StoredSnapshot],
	cancelled: &AtomicBool,
	judge: F,
) -> Result<Vec<T>, ScanFailure>
where
	T: Send,
	F: Fn(&str) -> T + Sync,
{
	let outcomes: Vec<Result<T, ScanFailure>> = snapshots
		.par_iter()
		.enumerate()
		.map(|(index, snapshot)| {
			if cancelled.load(Ordering::Relaxed) {
				return Err(ScanFailure::Cancelled);
			}
			let decoded: Cow<[u8]> = match snapshot.codec {
				SnapshotCodec::None => Cow::Borrowed(snapshot.body),
				SnapshotCodec::Zstd => {
					Cow::Owned(zstd::stream::decode_all(snapshot.body).map_err(|error| {
						ScanFailure::Undecodable(ScanError {
							index,
							reason: error.to_string(),
						})
					})?)
				}
			};
			Ok(judge(&String::from_utf8_lossy(&decoded)))
		})
		.collect();
	// A cancellation was asked for, so it is what the caller hears, whatever
	// else a snapshot of the same batch reported.
	if outcomes
		.iter()
		.any(|outcome| matches!(outcome, Err(ScanFailure::Cancelled)))
	{
		return Err(ScanFailure::Cancelled);
	}
	outcomes.into_iter().collect()
}

/// Judges every snapshot of a batch against a selector plan, in parallel on
/// rayon's pool, and returns one outcome per snapshot in input order.
///
/// See [`judge_snapshots`] for how a snapshot is decoded and how `cancelled`
/// stops the scan.
///
/// # Errors
///
/// See [`judge_snapshots`].
pub fn scan_snapshots(
	plan: &SelectorPlan,
	snapshots: &[StoredSnapshot],
	cancelled: &AtomicBool,
) -> Result<Vec<HtmlMatchOutcome>, ScanFailure> {
	judge_snapshots(snapshots, cancelled, |text| {
		html_matches_selector(plan, text.as_bytes())
	})
}

#[cfg(test)]
mod tests {
	use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

	use super::{ScanFailure, SnapshotCodec, StoredSnapshot, judge_snapshots, scan_snapshots};
	use crate::selector_plan::{Alternative, Compound, Conditions, SelectorPlan};

	fn plan_for(tag: &str) -> SelectorPlan {
		SelectorPlan {
			alternatives: vec![Alternative {
				compounds: vec![Compound {
					conditions: Conditions {
						tag: Some(tag.to_owned()),
						..Conditions::default()
					},
					negations: vec![],
				}],
				combinators: vec![],
				prefilter_literals: Some(vec![format!("<{tag}").into_bytes()]),
				direct: true,
			}],
			needs_child_index: false,
			needs_type_index: false,
		}
	}

	fn zstd(html: &str) -> Vec<u8> {
		zstd::stream::encode_all(html.as_bytes(), 3).unwrap()
	}

	fn running() -> AtomicBool {
		AtomicBool::new(false)
	}

	/// The corrupt snapshot's position; fails the test on any other failure.
	fn undecodable_index(failure: ScanFailure) -> usize {
		match failure {
			ScanFailure::Undecodable(error) => error.index,
			ScanFailure::Cancelled => panic!("expected a decode failure, got a cancellation"),
		}
	}

	#[test]
	fn judges_plain_and_compressed_snapshots_in_input_order() {
		let compressed = zstd("<p><img></p>");
		let snapshots = [
			StoredSnapshot {
				body: b"<img>",
				codec: SnapshotCodec::None,
			},
			StoredSnapshot {
				body: &compressed,
				codec: SnapshotCodec::Zstd,
			},
			StoredSnapshot {
				body: b"<p>",
				codec: SnapshotCodec::None,
			},
		];
		let outcomes = scan_snapshots(&plan_for("img"), &snapshots, &running()).unwrap();
		let matched: Vec<bool> = outcomes.iter().map(|o| o.matched).collect();
		assert_eq!(matched, [true, true, false]);
		assert!(outcomes[2].prefiltered);
	}

	#[test]
	fn reads_invalid_utf8_as_replacement_characters() {
		let mut body = b"<p title=\"".to_vec();
		body.extend_from_slice(&[0xff, 0xfe]);
		body.extend_from_slice(b"\"><img>");
		let snapshots = [StoredSnapshot {
			body: &body,
			codec: SnapshotCodec::None,
		}];
		assert!(scan_snapshots(&plan_for("img"), &snapshots, &running()).unwrap()[0].matched);
	}

	#[test]
	fn a_corrupt_zstd_snapshot_fails_the_scan() {
		let snapshots = [
			StoredSnapshot {
				body: b"<img>",
				codec: SnapshotCodec::None,
			},
			StoredSnapshot {
				body: b"not zstd",
				codec: SnapshotCodec::Zstd,
			},
		];
		let failure = scan_snapshots(&plan_for("img"), &snapshots, &running()).unwrap_err();
		assert_eq!(undecodable_index(failure), 1);
	}

	#[test]
	fn judge_snapshots_returns_results_in_input_order_whatever_the_thread() {
		let bodies: Vec<Vec<u8>> = (0..200)
			.map(|index| format!("document {index}").into_bytes())
			.collect();
		let snapshots: Vec<StoredSnapshot> = bodies
			.iter()
			.map(|body| StoredSnapshot {
				body,
				codec: SnapshotCodec::None,
			})
			.collect();
		let lengths = judge_snapshots(&snapshots, &running(), str::len).unwrap();
		let expected: Vec<usize> = bodies.iter().map(Vec::len).collect();
		assert_eq!(lengths, expected);
	}

	#[test]
	fn judge_snapshots_names_the_first_corrupt_snapshot() {
		let snapshots = [
			StoredSnapshot {
				body: b"fine",
				codec: SnapshotCodec::None,
			},
			StoredSnapshot {
				body: b"not zstd",
				codec: SnapshotCodec::Zstd,
			},
			StoredSnapshot {
				body: b"also not zstd",
				codec: SnapshotCodec::Zstd,
			},
		];
		let failure = judge_snapshots(&snapshots, &running(), str::len).unwrap_err();
		assert_eq!(undecodable_index(failure), 1);
	}

	#[test]
	fn an_empty_batch_has_no_outcomes() {
		assert!(
			scan_snapshots(&plan_for("img"), &[], &running())
				.unwrap()
				.is_empty()
		);
	}

	#[test]
	fn decodes_concatenated_zstd_frames_as_one_document() {
		let mut body = zstd("<p>");
		body.extend(zstd("<img>"));
		let snapshots = [StoredSnapshot {
			body: &body,
			codec: SnapshotCodec::Zstd,
		}];
		assert!(scan_snapshots(&plan_for("img"), &snapshots, &running()).unwrap()[0].matched);
	}

	#[test]
	fn a_flag_raised_before_the_scan_judges_nothing() {
		let snapshots = [StoredSnapshot {
			body: b"<img>",
			codec: SnapshotCodec::None,
		}; 50];
		let judged = AtomicUsize::new(0);
		let cancelled = AtomicBool::new(true);
		let failure = judge_snapshots(&snapshots, &cancelled, |_| {
			judged.fetch_add(1, Ordering::Relaxed);
		})
		.unwrap_err();
		assert!(matches!(failure, ScanFailure::Cancelled));
		assert_eq!(judged.load(Ordering::Relaxed), 0);
	}

	/// Runs `scan` on a pool of one thread, so the snapshots are taken strictly
	/// in input order and a test can say which one saw the flag.
	fn on_one_thread<R: Send>(scan: impl FnOnce() -> R + Send) -> R {
		rayon::ThreadPoolBuilder::new()
			.num_threads(1)
			.build()
			.unwrap()
			.install(scan)
	}

	#[test]
	fn a_flag_raised_mid_scan_skips_the_snapshots_not_yet_started() {
		let snapshots = vec![
			StoredSnapshot {
				body: b"<img>",
				codec: SnapshotCodec::None,
			};
			50
		];
		let judged = AtomicUsize::new(0);
		let cancelled = AtomicBool::new(false);
		let failure = on_one_thread(|| {
			judge_snapshots(&snapshots, &cancelled, |_| {
				judged.fetch_add(1, Ordering::Relaxed);
				cancelled.store(true, Ordering::Relaxed);
			})
		})
		.unwrap_err();
		assert!(matches!(failure, ScanFailure::Cancelled));
		// Only the snapshot that raised the flag was judged.
		assert_eq!(judged.load(Ordering::Relaxed), 1);
	}

	#[test]
	fn a_cancellation_seen_mid_scan_wins_over_a_corrupt_snapshot_that_failed_before_it() {
		let snapshots = [
			StoredSnapshot {
				body: b"not zstd",
				codec: SnapshotCodec::Zstd,
			},
			StoredSnapshot {
				body: b"raises the flag",
				codec: SnapshotCodec::None,
			},
			StoredSnapshot {
				body: b"finds the flag raised",
				codec: SnapshotCodec::None,
			},
		];
		let cancelled = AtomicBool::new(false);
		let failure = on_one_thread(|| {
			judge_snapshots(&snapshots, &cancelled, |_| {
				cancelled.store(true, Ordering::Relaxed);
			})
		})
		.unwrap_err();
		// The first failure by position is the corrupt snapshot; the cancellation is
		// what the caller asked for, so it is the one reported.
		assert!(matches!(failure, ScanFailure::Cancelled));
	}

	#[test]
	fn names_both_kinds_of_failure_in_its_message() {
		assert_eq!(ScanFailure::Cancelled.to_string(), "the scan was cancelled");
		let corrupt = ScanFailure::Undecodable(super::ScanError {
			index: 3,
			reason: "corrupt".to_owned(),
		});
		assert_eq!(
			corrupt.to_string(),
			"snapshot 3 could not be decoded: corrupt"
		);
	}

	#[test]
	fn a_flag_raised_before_the_scan_wins_over_a_corrupt_snapshot() {
		let snapshots = [
			StoredSnapshot {
				body: b"not zstd",
				codec: SnapshotCodec::Zstd,
			},
			StoredSnapshot {
				body: b"fine",
				codec: SnapshotCodec::None,
			},
		];
		let cancelled = AtomicBool::new(true);
		let failure = judge_snapshots(&snapshots, &cancelled, str::len).unwrap_err();
		assert!(matches!(failure, ScanFailure::Cancelled));
	}
}
