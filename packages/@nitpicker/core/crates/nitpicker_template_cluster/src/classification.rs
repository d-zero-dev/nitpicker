//! One whole classification: Pass 0's block keys from the pages' signals,
//! Stage A over their HTML (a [`Run`]), then Stage B and the reasons.
//!
//! The caller reads the corpus: the signals once, then the HTML once or
//! twice (see [`Run`]). Only the signals are held for the whole corpus; HTML
//! is held per block, or per sample for a block over the memory budget.

use indexmap::IndexMap;

use crate::blocking_reason::BlockingReason;
use crate::build_cluster_reason::LandmarkClusterProfile;
use crate::choose_sampled_blocks::{SampleReason, choose_sampled_blocks, pair_bytes};
use crate::extract_landmarks::LandmarkType;
use crate::page_signals::PageSignals;
use crate::pass0::resolve_block_keys;
use crate::run::{BLOCK_SAMPLE_SIZE, Context, PageInput, Progress, Run, RunError};
use crate::stage_b::stage_b;

/// Bytes a block's Stage A similarity table takes before the block is
/// clustered from a sample instead: the table is an upper triangle of `f64`,
/// `n * (n - 1) / 2 * 8` bytes for `n` pages, and the largest allocation of
/// a run. Blocks are clustered one at a time, so this bounds that table
/// whatever the corpus size; 512 MiB takes a block of about 11,500 pages
/// whole. The page limit ([`crate::EXACT_PAGE_LIMIT`]) samples the largest
/// blocks of a big corpus first, so a larger budget rarely changes which
/// blocks are sampled but raises the peak. Which blocks fall over it decides their stored keys, so changing it
/// reclassifies the archives it moves. A budget of 0 samples every block.
pub const TEMPLATE_MEMORY_BUDGET: u64 = 512 * 1024 * 1024;

/// A block clustered from a sample of its pages.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SampledBlock {
	/// Its key.
	pub block_key: String,
	/// Its pages.
	pub page_count: usize,
	/// Bytes its similarity table would have taken.
	pub pair_bytes: u64,
	/// Why it was sampled.
	pub reason: SampleReason,
}

/// A final cluster's reason, with the evidence of each block it came from.
#[derive(Clone, Debug, PartialEq)]
pub struct Reason {
	/// Its member pages (the sampled ones, for a sampled block).
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
	/// The blocks clustered from a sample, in block order.
	pub sampled_blocks: Vec<SampledBlock>,
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
		sampled_blocks: Vec<SampledBlock>,
	},
	/// An empty corpus, nothing to read.
	Empty,
}

/// A classification in progress.
pub struct Classification {
	state: State,
	memory_budget: u64,
}

impl Default for Classification {
	fn default() -> Self {
		Self::new(TEMPLATE_MEMORY_BUDGET)
	}
}

fn reading_ended() -> RunError {
	RunError::Protocol("the signals were already blocked".to_owned())
}

fn not_blocked() -> RunError {
	RunError::Protocol("the signals have not been blocked yet".to_owned())
}

impl Classification {
	/// Starts collecting the signals. A block whose Stage A similarity table
	/// would take more than `memory_budget` bytes is clustered from a sample
	/// of its pages (see [`TEMPLATE_MEMORY_BUDGET`]).
	#[must_use]
	pub fn new(memory_budget: u64) -> Self {
		Self {
			state: State::Signals(Vec::new()),
			memory_budget,
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
		let mut page_counts = vec![0usize; block_keys.len()];
		for &block in &block_of_page {
			page_counts[block as usize] += 1;
		}
		let budget = self.memory_budget;
		let chosen = choose_sampled_blocks(&page_counts, budget);
		let mut sampled_blocks = Vec::new();
		for (block, reason) in chosen.iter().enumerate() {
			let page_count = page_counts[block];
			// Only a block larger than its sample has pages left out of it; a
			// smaller one is clustered from all its pages either way, so
			// reporting it would be noise.
			let Some(reason) = reason else { continue };
			if page_count <= BLOCK_SAMPLE_SIZE {
				continue;
			}
			let bytes = pair_bytes(page_count);
			(context.progress)(Progress::BlockSampled {
				block_key: block_keys[block].clone(),
				page_count,
				pair_bytes: bytes,
				budget,
				reason: *reason,
			});
			sampled_blocks.push(SampledBlock {
				block_key: block_keys[block].clone(),
				page_count,
				pair_bytes: bytes,
				reason: *reason,
			});
		}
		let sampled: Vec<bool> = chosen.iter().map(Option::is_some).collect();
		let run = Box::new(Run::new(block_keys.clone(), block_of_page, sampled)?);
		self.state = State::Reading {
			run,
			block_keys,
			reasons: blocked.reasons.into_iter().collect(),
			sampled_blocks,
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
		let (run, block_keys, blocking_reasons, sampled_blocks) = match self.state {
			State::Signals(_) => return Err(not_blocked()),
			State::Empty => return Ok(ClassificationOutput::default()),
			State::Reading {
				run,
				block_keys,
				reasons,
				sampled_blocks,
			} => (run, block_keys, reasons, sampled_blocks),
		};
		let (output, vocabulary) = (*run).into_output()?;
		context.check()?;
		(context.progress)(Progress::StageBStart {
			unit_count: output.units.len(),
		});
		let result = stage_b(&output, &block_keys, &vocabulary);

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
			sampled_blocks,
		})
	}
}

#[cfg(test)]
mod tests {
	use std::sync::Mutex;
	use std::sync::atomic::AtomicBool;

	use super::{Classification, ClassificationOutput, SampledBlock};
	use crate::blocking_reason::BlockingReason;
	use crate::choose_sampled_blocks::{SampleReason, pair_bytes};
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
	/// stylesheets) and HTML, under the default memory budget.
	fn classify(sections: &[&str], html_list: &[&str]) -> (ClassificationOutput, Vec<Progress>) {
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::default();
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
		let mut classification = Classification::default();
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
		let mut classification = Classification::default();
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
		let mut classification = Classification::default();
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
		let mut classification = Classification::default();
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
		let mut classification = Classification::default();
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

	// One scenario read end to end: the events, the masks, the keys and the
	// reported blocks are asserted together because they describe one run.
	#[test]
	#[allow(clippy::too_many_lines)]
	fn samples_a_block_over_the_budget_and_assigns_its_unsampled_pages() {
		// 2,200 pages of two sections, alternating, each its own template. Each
		// block's table (1,100 pages) is over the budget of 1,000 pages', so
		// each keeps a sample of 100 pages and 2,000 pages are assigned in the
		// second read: a whole number of progress steps.
		let events = Mutex::new(Vec::new());
		let mut classification = Classification::new(pair_bytes(1000));
		classification
			.push_signals(
				(0..2_200)
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
		assert_eq!(keys.len(), 2_200);
		assert_eq!(
			keys.iter()
				.filter(|key| **key == "[\"path:a\",\"cluster:0\"]")
				.count(),
			1_100
		);
		assert_eq!(
			keys.iter()
				.filter(|key| **key == "[\"path:b\",\"cluster:0\"]")
				.count(),
			1_100
		);
		assert_eq!(keys[0], "[\"path:a\",\"cluster:0\"]");
		assert_eq!(keys[1], "[\"path:b\",\"cluster:0\"]");

		assert_eq!(
			output.sampled_blocks,
			vec![
				SampledBlock {
					block_key: "path:a".to_owned(),
					page_count: 1_100,
					pair_bytes: pair_bytes(1_100),
					reason: SampleReason::TableOverBudget,
				},
				SampledBlock {
					block_key: "path:b".to_owned(),
					page_count: 1_100,
					pair_bytes: pair_bytes(1_100),
					reason: SampleReason::TableOverBudget,
				},
			]
		);
		let events = events.into_inner().unwrap();
		assert!(events.contains(&Progress::BlockSampled {
			block_key: "path:a".to_owned(),
			page_count: 1_100,
			pair_bytes: pair_bytes(1_100),
			budget: pair_bytes(1_000),
			reason: SampleReason::TableOverBudget,
		}));
		let assigned: Vec<&Progress> = events
			.iter()
			.filter(|event| matches!(event, Progress::Assigned { .. }))
			.collect();
		assert_eq!(assigned.len(), 2);
		assert_eq!(
			assigned[0],
			&Progress::Assigned {
				pages_assigned: 1000,
				pages_to_assign: 2_000,
			}
		);
		assert_eq!(
			assigned[1],
			&Progress::Assigned {
				pages_assigned: 2_000,
				pages_to_assign: 2_000,
			}
		);
	}

	/// The blocks reported as sampled, with why, when classifying one section
	/// per entry of `pages` (that many pages each) under `budget`.
	fn sampled_under(budget: u64, pages: &[usize]) -> Vec<(String, SampleReason)> {
		let mut classification = Classification::new(budget);
		let signals = pages
			.iter()
			.enumerate()
			.flat_map(|(section, &count)| {
				(0..count).map(move |_| test_page(&[&format!("s{section}"), "1"], &[], None))
			})
			.collect();
		classification.push_signals(signals).unwrap();
		let events = Mutex::new(Vec::new());
		with_context(&events, |context| classification.block(context).unwrap());
		events
			.into_inner()
			.unwrap()
			.into_iter()
			.filter_map(|event| match event {
				Progress::BlockSampled {
					block_key, reason, ..
				} => Some((block_key, reason)),
				_ => None,
			})
			.collect()
	}

	#[test]
	fn reports_a_block_over_the_budget_with_its_table() {
		assert_eq!(
			sampled_under(40_399, &[101, 50]),
			vec![("path:s0".to_owned(), SampleReason::TableOverBudget)]
		);
		assert_eq!(sampled_under(40_400, &[101, 50]), vec![]);
	}

	#[test]
	fn reports_the_largest_block_when_the_pages_exceed_the_limit() {
		// 12,000 + 8,001 pages: over the limit by 1, so the larger goes.
		assert_eq!(
			sampled_under(u64::MAX, &[8_001, 12_000]),
			vec![("path:s1".to_owned(), SampleReason::PagesOverLimit)]
		);
	}

	#[test]
	fn a_block_no_larger_than_a_sample_is_never_reported_as_sampled() {
		// Nothing is left out of its sample, whatever the budget.
		assert_eq!(sampled_under(0, &[100]), vec![]);
		assert_eq!(sampled_under(0, &[3]), vec![]);
		assert_eq!(
			sampled_under(0, &[101]),
			vec![("path:s0".to_owned(), SampleReason::TableOverBudget)]
		);
	}

	#[test]
	fn rejects_the_result_before_blocking() {
		let events = Mutex::new(Vec::new());
		let classification = Classification::default();
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
		let mut classification = Classification::default();
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
		let mut classification = Classification::default();
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
		let mut classification = Classification::default();
		assert_eq!(
			classification.block(&Context {
				cancelled: &cancelled,
				progress: &report,
			}),
			Err(RunError::Cancelled)
		);
	}
}
