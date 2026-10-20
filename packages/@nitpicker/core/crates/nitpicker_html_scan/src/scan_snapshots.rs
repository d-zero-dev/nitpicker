use std::borrow::Cow;
use std::fmt;

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

/// Judges every snapshot of a batch against a selector plan, in parallel on
/// rayon's pool, and returns one outcome per snapshot in input order.
///
/// Each snapshot is decoded, judged and dropped by the task that took it, so
/// no more decoded documents are alive than there are threads. A document is
/// read as UTF-8 with every invalid sequence replaced by U+FFFD, the way
/// `Buffer.prototype.toString('utf8')` reads it.
///
/// # Errors
///
/// The first snapshot (by position) whose zstd data is corrupt. A snapshot
/// that cannot be decoded is never judged "no match": the scan has failed.
pub fn scan_snapshots(
	plan: &SelectorPlan,
	snapshots: &[StoredSnapshot],
) -> Result<Vec<HtmlMatchOutcome>, ScanError> {
	let outcomes: Vec<Result<HtmlMatchOutcome, ScanError>> = snapshots
		.par_iter()
		.enumerate()
		.map(|(index, snapshot)| {
			let decoded: Cow<[u8]> = match snapshot.codec {
				SnapshotCodec::None => Cow::Borrowed(snapshot.body),
				SnapshotCodec::Zstd => {
					Cow::Owned(zstd::stream::decode_all(snapshot.body).map_err(|error| {
						ScanError {
							index,
							reason: error.to_string(),
						}
					})?)
				}
			};
			let text = String::from_utf8_lossy(&decoded);
			Ok(html_matches_selector(plan, text.as_bytes()))
		})
		.collect();
	outcomes.into_iter().collect()
}

#[cfg(test)]
mod tests {
	use super::{SnapshotCodec, StoredSnapshot, scan_snapshots};
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
		let outcomes = scan_snapshots(&plan_for("img"), &snapshots).unwrap();
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
		assert!(scan_snapshots(&plan_for("img"), &snapshots).unwrap()[0].matched);
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
		let error = scan_snapshots(&plan_for("img"), &snapshots).unwrap_err();
		assert_eq!(error.index, 1);
	}

	#[test]
	fn an_empty_batch_has_no_outcomes() {
		assert!(scan_snapshots(&plan_for("img"), &[]).unwrap().is_empty());
	}

	#[test]
	fn decodes_concatenated_zstd_frames_as_one_document() {
		let mut body = zstd("<p>");
		body.extend(zstd("<img>"));
		let snapshots = [StoredSnapshot {
			body: &body,
			codec: SnapshotCodec::Zstd,
		}];
		assert!(scan_snapshots(&plan_for("img"), &snapshots).unwrap()[0].matched);
	}
}
