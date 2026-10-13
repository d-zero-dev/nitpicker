//! One whole classification: Pass 0's block keys from the pages' signals,
//! Stage A over their HTML (a [`Run`]), then Stage B and the reasons.
//!
//! The caller reads the corpus: the signals once, then the HTML once or
//! twice (see [`Run`]). Only the signals are held for the whole corpus; HTML
//! is held per block, or per sample when streaming.

use indexmap::IndexMap;

use crate::blocking_reason::BlockingReason;
use crate::build_cluster_reason::LandmarkClusterProfile;
use crate::extract_landmarks::LandmarkType;
use crate::page_signals::PageSignals;
use crate::pass0::resolve_block_keys;
use crate::run::{Context, Mode, PageInput, Progress, Run, RunError};
use crate::stage_b::stage_b;

/// Corpus size at or below which every page is kept until its block is
/// clustered and landmark chrome is judged across the whole corpus. Above it
/// a run streams: it keeps a sample per block, judges chrome per sampled
/// block, and assigns every other page to the nearest sampled cluster in a
/// second read.
///
/// Holding every page until its block is clustered is what a ~176,000-page
/// crawl could not afford; the corpora the classifier was validated on (302,
/// 1,416, 8,936 and 89 pages) sit well below 20,000, with room for sites
/// twice the largest. Which side of it a corpus falls on decides its stored
/// keys, so changing it reclassifies the archives it moves.
pub const CORPUS_INLINE_THRESHOLD: usize = 20_000;

/// A final cluster's reason, with the evidence of each block it came from.
#[derive(Clone, Debug, PartialEq)]
pub struct Reason {
	/// Its member pages (the sampled ones, when streaming).
	pub member_count: usize,
	/// Each block it came from, with the reason Pass 0 formed the block.
	pub blocking: Vec<(String, BlockingReason)>,
	/// The quorum core of its structural tokens, in UTF-16 order.
	pub structural_core_tokens: Vec<String>,
	/// Per landmark type its members carry, in landmark type order.
	pub landmarks: Vec<(LandmarkType, LandmarkClusterProfile)>,
	/// The other final clusters of its blocks, in UTF-16 order.
	pub sibling_cluster_keys: Vec<String>,
}

/// A whole classification's result.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClassificationOutput {
	/// Every final cluster key.
	pub keys: Vec<String>,
	/// Each page's key, as an index into [`ClassificationOutput::keys`].
	pub key_of_page: Vec<u32>,
	/// One reason per final cluster key, in the order Stage B emits them.
	pub reasons: Vec<(String, Reason)>,
}

/// Where a classification stands.
enum State {
	/// Collecting the signals.
	Signals(Vec<PageSignals>),
	/// Reading the HTML.
	Reading {
		run: Box<Run>,
		block_keys: Vec<String>,
		reasons: IndexMap<String, BlockingReason>,
		mode: Mode,
	},
	/// An empty corpus, nothing to read.
	Empty,
}

/// A classification in progress.
pub struct Classification {
	state: State,
}

impl Default for Classification {
	fn default() -> Self {
		Self::new()
	}
}

fn reading_ended() -> RunError {
	RunError::Protocol("the signals were already blocked".to_owned())
}

fn not_blocked() -> RunError {
	RunError::Protocol("the signals have not been blocked yet".to_owned())
}

impl Classification {
	/// Starts collecting the signals.
	#[must_use]
	pub fn new() -> Self {
		Self {
			state: State::Signals(Vec::new()),
		}
	}

	/// Adds the next pages' signals, in corpus order.
	///
	/// # Errors
	///
	/// [`RunError::Protocol`] after [`Classification::block`], or for a page
	/// whose stylesheet hosts do not pair up with its hrefs (one each).
	pub fn push_signals(&mut self, signals: Vec<PageSignals>) -> Result<(), RunError> {
		match &mut self.state {
			State::Signals(collected) => {
				if let Some(offset) = signals
					.iter()
					.position(|page| page.stylesheet_hosts.len() != page.stylesheet_hrefs.len())
				{
					let page = &signals[offset];
					return Err(RunError::Protocol(format!(
						"page {} has {} stylesheet hrefs but {} hosts",
						collected.len() + offset,
						page.stylesheet_hrefs.len(),
						page.stylesheet_hosts.len()
					)));
				}
				collected.extend(signals);
				Ok(())
			}
			_ => Err(reading_ended()),
		}
	}

	/// Runs Pass 0 over the signals and starts Stage A: blocks are clustered
	/// in the order their keys first appear among the pages.
	///
	/// # Errors
	///
	/// [`RunError::Cancelled`], or [`RunError::Protocol`] when called twice.
	///
	/// # Panics
	///
	/// With 2^32 blocks or more.
	pub fn block(&mut self, context: &Context) -> Result<(), RunError> {
		context.check()?;
		let State::Signals(signals) = &mut self.state else {
			return Err(reading_ended());
		};
		let signals = std::mem::take(signals);
		if signals.is_empty() {
			self.state = State::Empty;
			return Ok(());
		}
		let mode = if signals.len() > CORPUS_INLINE_THRESHOLD {
			Mode::Streaming
		} else {
			Mode::InMemory
		};
		let blocked = resolve_block_keys(&signals);
		drop(signals);

		let mut block_of_key: IndexMap<String, u32> = IndexMap::new();
		let block_of_page = blocked
			.key_of_page
			.into_iter()
			.map(|key| {
				let next = u32::try_from(block_of_key.len()).expect("fewer than 2^32 blocks");
				*block_of_key.entry(key).or_insert(next)
			})
			.collect();
		let block_keys: Vec<String> = block_of_key.into_keys().collect();
		let run = Box::new(Run::new(block_keys.clone(), block_of_page, mode)?);
		self.state = State::Reading {
			run,
			block_keys,
			reasons: blocked.reasons.into_iter().collect(),
			mode,
		};
		Ok(())
	}

	fn run(&mut self) -> Result<Option<&mut Run>, RunError> {
		match &mut self.state {
			State::Signals(_) => Err(not_blocked()),
			State::Reading { run, .. } => Ok(Some(run)),
			State::Empty => Ok(None),
		}
	}

	/// See [`Run::page_mask`]; empty for an empty corpus.
	///
	/// # Errors
	///
	/// [`RunError::Protocol`] before [`Classification::block`].
	pub fn page_mask(&self) -> Result<Vec<bool>, RunError> {
		match &self.state {
			State::Signals(_) => Err(not_blocked()),
			State::Reading { run, .. } => Ok(run.page_mask()),
			State::Empty => Ok(Vec::new()),
		}
	}

	/// See [`Run::push_pages`].
	///
	/// # Errors
	///
	/// As [`Run::push_pages`]; [`RunError::Protocol`] before
	/// [`Classification::block`] or with pages for an empty corpus.
	pub fn push_pages(&mut self, pages: Vec<PageInput>, context: &Context) -> Result<(), RunError> {
		match self.run()? {
			Some(run) => run.push_pages(pages, context),
			None if pages.is_empty() => Ok(()),
			None => Err(RunError::Protocol("the corpus is empty".to_owned())),
		}
	}

	/// See [`Run::finish_pages`].
	///
	/// # Errors
	///
	/// As [`Run::finish_pages`]; [`RunError::Protocol`] before
	/// [`Classification::block`].
	pub fn finish_pages(&mut self, context: &Context) -> Result<(), RunError> {
		self.run()?.map_or(Ok(()), |run| run.finish_pages(context))
	}

	/// See [`Run::needs_assignment`].
	#[must_use]
	pub fn needs_assignment(&self) -> bool {
		matches!(&self.state, State::Reading { run, .. } if run.needs_assignment())
	}

	/// See [`Run::push_assignment_pages`].
	///
	/// # Errors
	///
	/// As [`Run::push_assignment_pages`]; [`RunError::Protocol`] before
	/// [`Classification::block`] or for an empty corpus.
	pub fn push_assignment_pages(
		&mut self,
		pages: Vec<PageInput>,
		context: &Context,
	) -> Result<(), RunError> {
		match self.run()? {
			Some(run) => run.push_assignment_pages(pages, context),
			None => Err(RunError::Protocol("the corpus is empty".to_owned())),
		}
	}

	/// Runs Stage B and assembles the result.
	///
	/// # Errors
	///
	/// [`RunError::Cancelled`], or as [`Run::into_output`];
	/// [`RunError::Protocol`] before [`Classification::block`].
	///
	/// # Panics
	///
	/// When a final cluster carries a block key Pass 0 gave no reason for;
	/// Pass 0 gives every block key one.
	pub fn into_output(self, context: &Context) -> Result<ClassificationOutput, RunError> {
		let (run, block_keys, blocking_reasons, mode) = match self.state {
			State::Signals(_) => return Err(not_blocked()),
			State::Empty => return Ok(ClassificationOutput::default()),
			State::Reading {
				run,
				block_keys,
				reasons,
				mode,
			} => (run, block_keys, reasons, mode),
		};
		let (output, vocabulary) = (*run).into_output()?;
		context.check()?;
		(context.progress)(Progress::StageBStart {
			unit_count: output.units.len(),
		});
		let result = stage_b(&output, &block_keys, &vocabulary, mode == Mode::Streaming);

		let reasons = result
			.reasons
			.into_iter()
			.map(|(key, reason)| {
				let blocking = reason
					.block_keys
					.into_iter()
					.map(|block_key| {
						let evidence = blocking_reasons
							.get(&block_key)
							.expect("Pass 0 gives every block key a reason")
							.clone();
						(block_key, evidence)
					})
					.collect();
				(
					key,
					Reason {
						member_count: reason.member_count,
						blocking,
						structural_core_tokens: reason.structural_core_tokens,
						landmarks: reason.landmarks,
						sibling_cluster_keys: reason.sibling_cluster_keys,
					},
				)
			})
			.collect();
		Ok(ClassificationOutput {
			keys: output.keys,
			key_of_page: result.final_key_of_page,
			reasons,
		})
	}
}

#[cfg(test)]
mod tests {
	use std::sync::Mutex;
	use std::sync::atomic::AtomicBool;

	use super::{Classification, ClassificationOutput};
	use crate::blocking_reason::BlockingReason;
	use crate::page_signals::test_page;
	use crate::run::{Context, PageInput, Progress, RunError};

	const LIST: &str = "<body><main><ul><li><a>x</a></li><li><a>y</a></li></ul></main></body>";
	const DETAIL: &str =
		"<body><main><article><h1>t</h1><p>p</p><figure><img></figure></article></main></body>";

	/// Runs `call` with a context that records the progress events.
	fn with_context<T>(events: &Mutex<Vec<Progress>>, call: impl FnOnce(&Context) -> T) -> T {
		let cancelled = AtomicBool::new(false);
		let report = |event: Progress| events.lock().unwrap().push(event);
		call(&Context {
			cancelled: &cancelled,
			progress: &report,
		})
	}

	fn pages(html_list: &[&str]) -> Vec<PageInput> {
		html_list
			.iter()
			.map(|html| PageInput {
				html: (*html).to_owned(),
				content_root: None,
			})
			.collect()
	}

	/// Classifies pages of the given sections (one path segment each, no
	/// stylesheets) and HTML, in memory.
	fn classify(sections: &[&str], html_list: &[&str]) -> (ClassificationOutput, Vec<Progress>) {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		classification
			.push_signals(
				sections
					.iter()
					.map(|section| test_page(&[section, "1"], &[], None))
					.collect(),
			)
			.unwrap();
		let output = with_context(&events, |context| {
			classification.block(context).unwrap();
			classification
				.push_pages(pages(html_list), context)
				.unwrap();
			classification.finish_pages(context).unwrap();
			classification.into_output(context).unwrap()
		});
		(output, events.into_inner().unwrap())
	}

	fn keys_of(output: &ClassificationOutput) -> Vec<&str> {
		output
			.key_of_page
			.iter()
			.map(|&key| output.keys[key as usize].as_str())
			.collect()
	}

	#[test]
	fn clusters_blocks_in_first_appearance_order_and_merges_a_template_across_them() {
		// The about page shares the news detail pages' template, so Stage B
		// merges its cluster into theirs.
		let (output, events) = classify(
			&["news", "about", "news", "news", "news"],
			&[LIST, DETAIL, LIST, DETAIL, DETAIL],
		);
		assert_eq!(
			keys_of(&output),
			vec![
				"[\"path:news\",\"cluster:0\"]",
				"[\"path:news\",\"cluster:1\"]",
				"[\"path:news\",\"cluster:0\"]",
				"[\"path:news\",\"cluster:1\"]",
				"[\"path:news\",\"cluster:1\"]",
			]
		);
		let merged = &output
			.reasons
			.iter()
			.find(|(key, _)| key == "[\"path:news\",\"cluster:1\"]")
			.unwrap()
			.1;
		assert_eq!(merged.member_count, 3);
		assert_eq!(
			merged
				.blocking
				.iter()
				.map(|(block_key, _)| block_key.as_str())
				.collect::<Vec<_>>(),
			vec!["path:news", "path:about"]
		);
		assert_eq!(
			events,
			vec![
				Progress::BlockComplete {
					block_key: "path:news".to_owned(),
					blocks_processed: 1,
					total_blocks: 2,
				},
				Progress::BlockComplete {
					block_key: "path:about".to_owned(),
					blocks_processed: 2,
					total_blocks: 2,
				},
				Progress::StageBStart { unit_count: 3 },
			]
		);
	}

	#[test]
	fn attaches_each_block_reason_to_the_cluster_reasons() {
		let (output, _) = classify(&["news", "news"], &[LIST, LIST]);
		let [(key, reason)] = output.reasons.as_slice() else {
			panic!("one cluster expected, got {:?}", output.reasons);
		};
		assert_eq!(key, "[\"path:news\",\"cluster:0\"]");
		assert_eq!(reason.member_count, 2);
		assert_eq!(
			reason.blocking,
			vec![(
				"path:news".to_owned(),
				BlockingReason::Path {
					path_key: "news".to_owned()
				}
			)]
		);
		assert!(reason.sibling_cluster_keys.is_empty());
	}

	#[test]
	fn classifies_an_empty_corpus_to_nothing() {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		let output = with_context(&events, |context| {
			classification.block(context).unwrap();
			assert_eq!(classification.page_mask(), Ok(Vec::new()));
			classification.push_pages(Vec::new(), context).unwrap();
			classification.finish_pages(context).unwrap();
			assert!(!classification.needs_assignment());
			classification.into_output(context).unwrap()
		});
		assert_eq!(output, ClassificationOutput::default());
		assert!(events.into_inner().unwrap().is_empty());
	}

	#[test]
	fn rejects_pages_for_an_empty_corpus() {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		with_context(&events, |context| {
			classification.block(context).unwrap();
			assert_eq!(
				classification.push_pages(pages(&[LIST]), context),
				Err(RunError::Protocol("the corpus is empty".to_owned()))
			);
		});
	}

	#[test]
	fn rejects_reading_html_before_blocking() {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		classification
			.push_signals(vec![test_page(&["news"], &[], None)])
			.unwrap();
		let not_blocked = RunError::Protocol("the signals have not been blocked yet".to_owned());
		assert_eq!(classification.page_mask(), Err(not_blocked.clone()));
		with_context(&events, |context| {
			assert_eq!(
				classification.push_pages(pages(&[LIST]), context),
				Err(not_blocked)
			);
		});
	}

	#[test]
	fn rejects_signals_after_blocking_and_blocking_twice() {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		let already = Err(RunError::Protocol(
			"the signals were already blocked".to_owned(),
		));
		with_context(&events, |context| {
			classification.block(context).unwrap();
			assert_eq!(classification.block(context), already);
		});
		assert_eq!(
			classification.push_signals(vec![test_page(&["news"], &[], None)]),
			already
		);
	}

	#[test]
	fn rejects_signals_whose_hosts_do_not_pair_up_with_their_hrefs() {
		let mut classification = Classification::new();
		classification
			.push_signals(vec![test_page(&["news"], &[], None)])
			.unwrap();
		let mut unpaired = test_page(&["news"], &["https://example.com/a.css"], None);
		unpaired.stylesheet_hosts.clear();
		assert_eq!(
			classification.push_signals(vec![unpaired]),
			Err(RunError::Protocol(
				"page 1 has 1 stylesheet hrefs but 0 hosts".to_owned()
			))
		);
	}

	#[test]
	fn streams_a_corpus_above_the_inline_threshold_and_assigns_the_unsampled_pages() {
		// 20,200 pages of two sections, alternating, each its own template.
		// Each block keeps a sample of 100 pages, so 20,000 pages are assigned
		// in the second read: a whole number of progress steps.
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		classification
			.push_signals(
				(0..20_200)
					.map(|index| {
						let section = ["a", "b"][index % 2];
						test_page(&[section, "1"], &[], None)
					})
					.collect(),
			)
			.unwrap();
		let html_of = |index: usize| [LIST, DETAIL][index % 2];
		let pages_of = |mask: &[bool]| -> Vec<PageInput> {
			mask.iter()
				.enumerate()
				.map(|(index, selected)| PageInput {
					html: selected
						.then(|| html_of(index).to_owned())
						.unwrap_or_default(),
					content_root: None,
				})
				.collect()
		};
		let (output, needed_before_pages, needed_after_pages, needed_after_assignment) =
			with_context(&events, |context| {
				classification.block(context).unwrap();
				let needed_before_pages = classification.needs_assignment();
				let mask = classification.page_mask().unwrap();
				classification.push_pages(pages_of(&mask), context).unwrap();
				classification.finish_pages(context).unwrap();
				let needed_after_pages = classification.needs_assignment();
				let assignment_mask = classification.page_mask().unwrap();
				classification
					.push_assignment_pages(pages_of(&assignment_mask), context)
					.unwrap();
				let needed_after_assignment = classification.needs_assignment();
				(
					classification.into_output(context).unwrap(),
					needed_before_pages,
					needed_after_pages,
					needed_after_assignment,
				)
			});
		assert!(!needed_before_pages);
		assert!(needed_after_pages);
		assert!(!needed_after_assignment);

		let keys = keys_of(&output);
		assert_eq!(keys.len(), 20_200);
		assert_eq!(
			keys.iter()
				.filter(|key| **key == "[\"path:a\",\"cluster:0\"]")
				.count(),
			10_100
		);
		assert_eq!(
			keys.iter()
				.filter(|key| **key == "[\"path:b\",\"cluster:0\"]")
				.count(),
			10_100
		);
		assert_eq!(keys[0], "[\"path:a\",\"cluster:0\"]");
		assert_eq!(keys[1], "[\"path:b\",\"cluster:0\"]");

		let events = events.into_inner().unwrap();
		let assigned: Vec<&Progress> = events
			.iter()
			.filter(|event| matches!(event, Progress::Assigned { .. }))
			.collect();
		assert_eq!(assigned.len(), 20);
		assert_eq!(
			assigned[0],
			&Progress::Assigned {
				pages_assigned: 1000,
				pages_to_assign: 20_000,
			}
		);
		assert_eq!(
			assigned[19],
			&Progress::Assigned {
				pages_assigned: 20_000,
				pages_to_assign: 20_000,
			}
		);
	}

	#[test]
	fn rejects_the_result_before_blocking() {
		let events = Mutex::new(Vec::new());
		let classification = Classification::new();
		with_context(&events, |context| {
			assert_eq!(
				classification.into_output(context),
				Err(RunError::Protocol(
					"the signals have not been blocked yet".to_owned()
				))
			);
		});
	}

	#[test]
	fn rejects_assignment_pages_for_an_empty_corpus() {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		with_context(&events, |context| {
			classification.block(context).unwrap();
			assert_eq!(
				classification.push_assignment_pages(pages(&[LIST]), context),
				Err(RunError::Protocol("the corpus is empty".to_owned()))
			);
		});
	}

	#[test]
	fn stops_the_result_when_cancelled() {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new();
		classification
			.push_signals(vec![test_page(&["news", "1"], &[], None)])
			.unwrap();
		with_context(&events, |context| {
			classification.block(context).unwrap();
			classification.push_pages(pages(&[LIST]), context).unwrap();
			classification.finish_pages(context).unwrap();
		});
		let cancelled = AtomicBool::new(true);
		let report = |_: Progress| {};
		assert_eq!(
			classification.into_output(&Context {
				cancelled: &cancelled,
				progress: &report,
			}),
			Err(RunError::Cancelled)
		);
	}

	#[test]
	fn stops_blocking_when_cancelled() {
		let cancelled = AtomicBool::new(true);
		let report = |_: Progress| {};
		let mut classification = Classification::new();
		assert_eq!(
			classification.block(&Context {
				cancelled: &cancelled,
				progress: &report,
			}),
			Err(RunError::Cancelled)
		);
	}
}
