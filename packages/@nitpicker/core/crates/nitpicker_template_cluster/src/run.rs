//! One classification run: pages in, Stage A's clusters out.

use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::*;
use rustc_hash::FxHashSet;

use crate::content_root::ContentRoot;
use crate::extract_landmarks::LandmarkType;
use crate::jaccard::{jaccard, sorted_set};
use crate::local_chrome::compute_local_chrome;
use crate::page::{LandmarkInstance, Preparation, PreparedPage, assignment_tokens, prepare_page};
use crate::seeded_random::SeededRandom;
use crate::stage_a::{BlockMember, StageAResult, stage_a};
use crate::vocabulary::{Ids, ScratchVocabulary, Vocabulary};

/// Pages per block a streaming run clusters; the rest of a larger block is
/// assigned to the nearest of those clusters afterwards. Bounds what a run
/// holds per block (and Stage B's input) whatever the corpus size. Which
/// pages are sampled, and so every streamed archive's stored keys, depends
/// on it: changing it reclassifies those archives.
pub const BLOCK_SAMPLE_SIZE: usize = 100;

/// Assigned pages between two [`Progress::Assigned`] events: often enough
/// for a live count, rarely enough not to flood the caller.
const ASSIGNED_PER_PROGRESS: usize = 1000;

/// One page as the caller reads it.
pub struct PageInput {
	/// The page's HTML (ignored, and may be empty, for a page
	/// [`Run::page_mask`] leaves out).
	pub html: String,
	/// The crawler's content-root hint, when it detected one.
	pub content_root: Option<ContentRoot>,
}

/// How a run reads its pages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
	/// Keep every page and discover local chrome across the whole corpus.
	InMemory,
	/// Keep a sample per block; chrome is discovered per sampled block, and
	/// pages outside the samples are assigned in a second read.
	Streaming,
}

/// A progress event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Progress {
	/// A block's Stage A finished.
	BlockComplete {
		/// Its key.
		block_key: String,
		/// Blocks finished so far.
		blocks_processed: usize,
		/// All blocks.
		total_blocks: usize,
	},
	/// Another [`ASSIGNED_PER_PROGRESS`] pages outside the samples were
	/// assigned.
	Assigned {
		/// Assigned so far.
		pages_assigned: usize,
		/// To assign in all.
		pages_to_assign: usize,
	},
	/// Stage B began merging Stage A's clusters across blocks (it reports no
	/// further progress of its own).
	StageBStart {
		/// Stage A's clusters entering it.
		unit_count: usize,
	},
}

/// Why a run stopped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunError {
	/// The caller cancelled it.
	Cancelled,
	/// The caller broke the protocol (more pages than announced, a call out
	/// of order).
	Protocol(String),
}

/// What a call needs from its caller besides the pages.
pub struct Context<'a> {
	/// Set to stop at the next page or block.
	pub cancelled: &'a AtomicBool,
	/// Receives progress events, in order, on the thread that made the call.
	pub progress: &'a (dyn Fn(Progress) + Sync),
}

impl Context<'_> {
	pub(crate) fn check(&self) -> Result<(), RunError> {
		if self.cancelled.load(Ordering::Relaxed) {
			Err(RunError::Cancelled)
		} else {
			Ok(())
		}
	}
}

/// One member of a Stage B unit.
#[derive(Debug, PartialEq, Eq)]
pub struct UnitMember {
	/// Its index among the run's pages.
	pub page_index: u32,
	/// Its compared tokens, in insertion order.
	pub tokens: Vec<u32>,
	/// Its landmark instances' types and tokens.
	pub instances: Vec<(LandmarkType, Vec<u32>)>,
}

/// One Stage A cluster, as Stage B merges it.
#[derive(Debug, PartialEq, Eq)]
pub struct Unit {
	/// Index of its key in [`Output::keys`].
	pub key: u32,
	/// Index of its block in the run's block keys.
	pub block: u32,
	/// Its members (all of them, or the sampled ones when streaming).
	pub members: Vec<UnitMember>,
}

/// Stage A's result for a whole run.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Output {
	/// Every cluster key handed out.
	pub keys: Vec<String>,
	/// Each page's key, as an index into [`Output::keys`].
	pub key_of_page: Vec<u32>,
	/// The units, in block order (streaming: in the order blocks completed).
	pub units: Vec<Unit>,
}

/// Marks a page no key was written for, which [`Run::into_output`] turns
/// into an error.
const NO_KEY: u32 = u32::MAX;

/// Marks a page outside every sample (streaming), or one with nothing to
/// assign it to.
const NONE: u32 = u32::MAX;

/// What a sampled block keeps for assigning its other pages.
struct BlockAssignment {
	max_depth: Option<usize>,
	allowed_classes: Option<FxHashSet<u32>>,
	local_signatures: FxHashSet<Vec<u32>>,
	/// `(key index, members' ascending token sets)`, in cluster order.
	clusters: Vec<(u32, Vec<Vec<u32>>)>,
}

/// A block's sample while the first read streams past it.
struct Sample {
	/// Its page indices, in reservoir slot order.
	pages: Vec<u32>,
	/// Their prepared pages, by slot.
	prepared: Vec<Option<PreparedPage>>,
	/// The block's pages read so far, sampled or not.
	seen: usize,
}

/// Which read a run expects next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
	First,
	Assignment,
	Done,
}

/// The pages each block's sample ends up with: Algorithm R per block, in
/// page order, each block seeded by its own key, as the stored keys were
/// sampled. Computed upfront from the block of every page — the sample does
/// not depend on page content — so the first read prepares only the pages
/// that stay sampled.
///
/// The TypeScript the stored samples came from (removed in #426), per page
/// in order — unlike `reservoir_sample_positions`, which Stage B uses, it keeps the
/// slot order, which decides cluster labels:
///
/// ```text
/// if (bucket.pages.length < size) bucket.pages.push(page);
/// else {
///   const j = Math.floor(bucket.prng() * (bucket.seen + 1));
///   if (j < size) bucket.pages[j] = page;
/// }
/// bucket.seen++;
/// ```
fn sample_blocks(
	block_keys: &[String],
	block_of_page: &[u32],
	sample_size: usize,
) -> Vec<Vec<u32>> {
	let mut randoms: Vec<Option<SeededRandom>> = block_keys.iter().map(|_| None).collect();
	let mut seen = vec![0usize; block_keys.len()];
	let mut samples: Vec<Vec<u32>> = vec![Vec::new(); block_keys.len()];
	for (page_index, &block) in block_of_page.iter().enumerate() {
		let block = block as usize;
		let page_index = u32::try_from(page_index).expect("fewer than 2^32 pages");
		let sample = &mut samples[block];
		if sample.len() < sample_size {
			sample.push(page_index);
		} else {
			let random =
				randoms[block].get_or_insert_with(|| SeededRandom::from_key(&block_keys[block]));
			// `floor(random * (seen + 1))`, exactly as JavaScript computes it.
			#[allow(
				clippy::cast_possible_truncation,
				clippy::cast_sign_loss,
				clippy::cast_precision_loss
			)]
			let slot = (random.next_f64() * (seen[block] + 1) as f64).floor() as usize;
			if slot < sample_size {
				sample[slot] = page_index;
			}
		}
		seen[block] += 1;
	}
	samples
}

/// The cluster key whose members include the one most similar to `tokens`
/// (Jaccard), ties to the earlier cluster; `None` only without clusters.
fn nearest_cluster(tokens: &[u32], clusters: &[(u32, Vec<Vec<u32>>)]) -> Option<u32> {
	let mut best = None;
	let mut best_score = -1.0;
	for (key, members) in clusters {
		let mut cluster_best = 0.0;
		for member in members {
			let score = jaccard(tokens, member);
			if score > cluster_best {
				cluster_best = score;
			}
		}
		if cluster_best > best_score {
			best_score = cluster_best;
			best = Some(*key);
		}
	}
	best
}

/// A run in progress.
pub struct Run {
	vocabulary: Vocabulary,
	block_keys: Vec<String>,
	block_of_page: Vec<u32>,
	block_sizes: Vec<usize>,
	mode: Mode,
	sample_size: usize,
	phase: Phase,
	next_page: usize,
	output: Output,
	/// In memory: every page, until its block's Stage A.
	pages: Vec<Option<PreparedPage>>,
	/// Streaming: each unfinished block's sample.
	samples: Vec<Option<Sample>>,
	/// Streaming: each page's slot in its block's sample, or [`NONE`].
	slot_of_page: Vec<u32>,
	blocks_completed: usize,
	/// Streaming: the block a page outside the samples is assigned in, or
	/// [`NONE`].
	pending_block_of_page: Vec<u32>,
	pending_count: usize,
	assignments: Vec<Option<BlockAssignment>>,
	assignment_cursor: usize,
	assigned: usize,
}

impl Run {
	/// Starts a run over pages whose blocks are already known.
	///
	/// # Errors
	///
	/// [`RunError::Protocol`] when a page's block index is out of range or a
	/// block has no pages.
	pub fn new(
		block_keys: Vec<String>,
		block_of_page: Vec<u32>,
		mode: Mode,
	) -> Result<Self, RunError> {
		Self::with_sample_size(block_keys, block_of_page, mode, BLOCK_SAMPLE_SIZE)
	}

	/// [`Run::new`] with another sample size, so tests can stream small
	/// corpora.
	pub(crate) fn with_sample_size(
		block_keys: Vec<String>,
		block_of_page: Vec<u32>,
		mode: Mode,
		sample_size: usize,
	) -> Result<Self, RunError> {
		let mut block_sizes = vec![0usize; block_keys.len()];
		for &block in &block_of_page {
			*block_sizes.get_mut(block as usize).ok_or_else(|| {
				RunError::Protocol(format!("page block {block} is out of range"))
			})? += 1;
		}
		if let Some(empty) = block_sizes.iter().position(|&size| size == 0) {
			return Err(RunError::Protocol(format!("block {empty} has no pages")));
		}
		let page_count = block_of_page.len();
		let block_count = block_keys.len();

		let mut samples = Vec::new();
		let mut slot_of_page = Vec::new();
		let mut pending_block_of_page = Vec::new();
		let mut pending_count = 0;
		if mode == Mode::Streaming {
			slot_of_page = vec![NONE; page_count];
			for pages in sample_blocks(&block_keys, &block_of_page, sample_size) {
				for (slot, &page) in pages.iter().enumerate() {
					slot_of_page[page as usize] = u32::try_from(slot).expect("slot fits");
				}
				samples.push(Some(Sample {
					prepared: pages.iter().map(|_| None).collect(),
					pages,
					seen: 0,
				}));
			}
			pending_block_of_page = slot_of_page
				.iter()
				.zip(&block_of_page)
				.map(|(&slot, &block)| if slot == NONE { block } else { NONE })
				.collect();
			pending_count = pending_block_of_page
				.iter()
				.filter(|&&block| block != NONE)
				.count();
		}

		Ok(Self {
			vocabulary: Vocabulary::default(),
			block_keys,
			block_of_page,
			block_sizes,
			mode,
			sample_size,
			phase: Phase::First,
			next_page: 0,
			output: Output {
				keys: Vec::new(),
				key_of_page: vec![NO_KEY; page_count],
				units: Vec::new(),
			},
			pages: Vec::new(),
			samples,
			slot_of_page,
			blocks_completed: 0,
			pending_block_of_page,
			pending_count,
			assignments: (0..block_count).map(|_| None).collect(),
			assignment_cursor: 0,
			assigned: 0,
		})
	}

	fn preparation(pool_size: usize) -> Preparation {
		Preparation {
			sweep: pool_size > 1,
			retain_markup: pool_size
				>= crate::derive_comparison_sets::MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT,
		}
	}

	/// Which pages the current read uses (`true`) — every page in memory,
	/// the sampled ones on a streaming first read, the others on the
	/// assignment read; none once both are done. A caller may send the
	/// others with empty HTML.
	#[must_use]
	pub fn page_mask(&self) -> Vec<bool> {
		match (self.phase, self.mode) {
			(Phase::First, Mode::InMemory) => vec![true; self.block_of_page.len()],
			(Phase::First, Mode::Streaming) => {
				self.slot_of_page.iter().map(|&slot| slot != NONE).collect()
			}
			(Phase::Assignment, _) => self
				.pending_block_of_page
				.iter()
				.map(|&block| block != NONE)
				.collect(),
			(Phase::Done, _) => vec![false; self.block_of_page.len()],
		}
	}

	/// Reads the next pages (in corpus order).
	///
	/// # Errors
	///
	/// [`RunError::Cancelled`], or [`RunError::Protocol`] past the last page
	/// or after the first read ended.
	pub fn push_pages(&mut self, pages: Vec<PageInput>, context: &Context) -> Result<(), RunError> {
		context.check()?;
		if self.phase != Phase::First {
			return Err(RunError::Protocol(
				"pages were pushed after the first read ended".to_owned(),
			));
		}
		let first = self.next_page;
		if first + pages.len() > self.block_of_page.len() {
			return Err(RunError::Protocol(format!(
				"received page {} of {}",
				first + pages.len(),
				self.block_of_page.len()
			)));
		}
		self.next_page += pages.len();
		match self.mode {
			Mode::InMemory => self.push_in_memory(first, pages, context),
			Mode::Streaming => self.push_streaming(first, pages, context),
		}
	}

	fn push_in_memory(
		&mut self,
		first: usize,
		pages: Vec<PageInput>,
		context: &Context,
	) -> Result<(), RunError> {
		let vocabulary = &self.vocabulary;
		let block_of_page = &self.block_of_page;
		let block_sizes = &self.block_sizes;
		let prepared: Vec<Option<PreparedPage>> = pages
			.into_par_iter()
			.enumerate()
			.map(|(offset, page)| {
				if context.cancelled.load(Ordering::Relaxed) {
					return None;
				}
				let block = block_of_page[first + offset] as usize;
				Some(prepare_page(
					&page.html,
					page.content_root.as_ref(),
					Self::preparation(block_sizes[block]),
					&mut Ids::Shared(vocabulary),
				))
			})
			.collect();
		context.check()?;
		self.pages.extend(prepared);
		Ok(())
	}

	fn push_streaming(
		&mut self,
		first: usize,
		pages: Vec<PageInput>,
		context: &Context,
	) -> Result<(), RunError> {
		let page_count = pages.len();
		let block_of_page = &self.block_of_page;
		let block_sizes = &self.block_sizes;
		let slot_of_page = &self.slot_of_page;
		let sample_size = self.sample_size;
		let vocabulary = &self.vocabulary;
		let read: Vec<(usize, usize, PreparedPage)> = pages
			.into_par_iter()
			.enumerate()
			.filter_map(|(offset, page)| {
				let page_index = first + offset;
				let slot = slot_of_page[page_index];
				if slot == NONE || context.cancelled.load(Ordering::Relaxed) {
					return None;
				}
				let block = block_of_page[page_index] as usize;
				let prepared = prepare_page(
					&page.html,
					page.content_root.as_ref(),
					Self::preparation(block_sizes[block].min(sample_size)),
					&mut Ids::Shared(vocabulary),
				);
				Some((block, slot as usize, prepared))
			})
			.collect();
		context.check()?;
		for (block, slot, prepared) in read {
			let sample = self.samples[block]
				.as_mut()
				.expect("a block being read is unfinished");
			sample.prepared[slot] = Some(prepared);
		}

		// Blocks complete in the order their last pages come.
		let mut completed: Vec<usize> = Vec::new();
		for page_index in first..first + page_count {
			let block = self.block_of_page[page_index] as usize;
			let sample = self.samples[block]
				.as_mut()
				.expect("a block with pages left is unfinished");
			sample.seen += 1;
			if sample.seen == self.block_sizes[block] {
				completed.push(block);
			}
		}
		for block in completed {
			context.check()?;
			let sample = self.samples[block]
				.take()
				.expect("a completing block is unfinished");
			self.flush_block(block, &sample);
			self.blocks_completed += 1;
			(context.progress)(Progress::BlockComplete {
				block_key: self.block_keys[block].clone(),
				blocks_processed: self.blocks_completed,
				total_blocks: self.block_keys.len(),
			});
		}
		Ok(())
	}

	fn add_key(&mut self, key: String) -> u32 {
		self.output.keys.push(key);
		u32::try_from(self.output.keys.len() - 1).expect("fewer than 2^32 keys")
	}

	/// Records Stage A's clusters as units and their members' keys.
	fn record_block(
		&mut self,
		block: usize,
		page_indices: &[u32],
		pages: &[&PreparedPage],
		result: &StageAResult,
	) -> Vec<u32> {
		let mut key_indices = Vec::with_capacity(result.clusters.len());
		for cluster in &result.clusters {
			let key = self.add_key(cluster.key.clone());
			key_indices.push(key);
			let members = cluster
				.positions
				.iter()
				.map(|&position| UnitMember {
					page_index: page_indices[position],
					tokens: result.token_sets[position].clone(),
					instances: pages[position]
						.instances
						.iter()
						.map(|instance| (instance.kind, instance.tokens.clone()))
						.collect(),
				})
				.collect();
			self.output.units.push(Unit {
				key,
				block: u32::try_from(block).expect("block fits"),
				members,
			});
		}
		for (position, &cluster) in result.cluster_of_member.iter().enumerate() {
			self.output.key_of_page[page_indices[position] as usize] = key_indices[cluster];
		}
		key_indices
	}

	fn flush_block(&mut self, block: usize, sample: &Sample) {
		let pages: Vec<&PreparedPage> = sample
			.prepared
			.iter()
			.map(|page| page.as_ref().expect("every sampled page was read"))
			.collect();
		let instances: Vec<&[LandmarkInstance]> =
			pages.iter().map(|page| page.instances.as_slice()).collect();
		let chrome = compute_local_chrome(&instances);
		let members: Vec<BlockMember> = pages
			.iter()
			.zip(&chrome.tokens_by_page)
			.map(|(page, local_tokens)| BlockMember { page, local_tokens })
			.collect();
		let result = stage_a(&self.block_keys[block], &members, &self.vocabulary);
		let key_indices = self.record_block(block, &sample.pages, &pages, &result);

		if sample.pages.len() < self.block_sizes[block] {
			let clusters = result
				.clusters
				.iter()
				.zip(&key_indices)
				.map(|(cluster, &key)| {
					(
						key,
						cluster
							.positions
							.iter()
							.map(|&position| sorted_set(&result.token_sets[position]))
							.collect(),
					)
				})
				.collect();
			self.assignments[block] = Some(BlockAssignment {
				max_depth: result.max_depth,
				allowed_classes: result.allowed_classes,
				local_signatures: chrome.signatures,
				clusters,
			});
		}
	}

	/// Ends the first read: an in-memory run clusters every block now; a
	/// streaming run has clustered each block as it completed.
	///
	/// # Errors
	///
	/// [`RunError::Cancelled`], or [`RunError::Protocol`] when pages are
	/// missing or the first read already ended.
	///
	/// # Panics
	///
	/// Never once every page was read, which the page count check
	/// establishes first.
	pub fn finish_pages(&mut self, context: &Context) -> Result<(), RunError> {
		if self.phase != Phase::First {
			return Err(RunError::Protocol(
				"the first read already ended".to_owned(),
			));
		}
		if self.next_page != self.block_of_page.len() {
			return Err(RunError::Protocol(format!(
				"received {} pages of {}",
				self.next_page,
				self.block_of_page.len()
			)));
		}
		if self.mode == Mode::Streaming {
			// Every block's last page was read, so every block completed.
			debug_assert!(self.samples.iter().all(Option::is_none));
			self.phase = if self.pending_count > 0 {
				Phase::Assignment
			} else {
				Phase::Done
			};
			return Ok(());
		}

		let mut pages = std::mem::take(&mut self.pages);
		let chrome = {
			let instances: Vec<&[LandmarkInstance]> = pages
				.iter()
				.map(|page| {
					page.as_ref()
						.expect("every page was read")
						.instances
						.as_slice()
				})
				.collect();
			compute_local_chrome(&instances)
		};
		let mut members_of_block: Vec<Vec<u32>> = vec![Vec::new(); self.block_keys.len()];
		for (page_index, &block) in self.block_of_page.iter().enumerate() {
			members_of_block[block as usize]
				.push(u32::try_from(page_index).expect("fewer than 2^32 pages"));
		}
		for (block, page_indices) in members_of_block.iter().enumerate() {
			context.check()?;
			{
				let block_pages: Vec<&PreparedPage> = page_indices
					.iter()
					.map(|&index| {
						pages[index as usize]
							.as_ref()
							.expect("a page is clustered once")
					})
					.collect();
				let members: Vec<BlockMember> = page_indices
					.iter()
					.zip(&block_pages)
					.map(|(&index, page)| BlockMember {
						page,
						local_tokens: &chrome.tokens_by_page[index as usize],
					})
					.collect();
				let result = stage_a(&self.block_keys[block], &members, &self.vocabulary);
				self.record_block(block, page_indices, &block_pages, &result);
			}
			// A block's pages are not needed past its own Stage A.
			for &index in page_indices {
				pages[index as usize] = None;
			}
			self.blocks_completed += 1;
			(context.progress)(Progress::BlockComplete {
				block_key: self.block_keys[block].clone(),
				blocks_processed: self.blocks_completed,
				total_blocks: self.block_keys.len(),
			});
		}
		self.phase = Phase::Done;
		Ok(())
	}

	/// Whether the run now expects the assignment read: a streaming run whose
	/// first read ended with pages outside the samples, until that read ends.
	#[must_use]
	pub fn needs_assignment(&self) -> bool {
		self.phase == Phase::Assignment
	}

	/// Assigns the next pages of the second read (in corpus order; pages
	/// that were sampled are skipped) to the nearest cluster of their block:
	/// the highest Jaccard similarity to any sampled member, ties to the
	/// earlier cluster.
	///
	/// # Errors
	///
	/// [`RunError::Cancelled`], or [`RunError::Protocol`] past the last page
	/// or when the run expects no assignment read.
	pub fn push_assignment_pages(
		&mut self,
		pages: Vec<PageInput>,
		context: &Context,
	) -> Result<(), RunError> {
		context.check()?;
		if self.phase != Phase::Assignment {
			return Err(RunError::Protocol(
				"the run expects no pages to assign".to_owned(),
			));
		}
		let first = self.assignment_cursor;
		if first + pages.len() > self.block_of_page.len() {
			return Err(RunError::Protocol(
				"received more pages to assign than the corpus has".to_owned(),
			));
		}
		self.assignment_cursor += pages.len();
		let pending = &self.pending_block_of_page;
		let assignments = &self.assignments;
		let vocabulary = &self.vocabulary;
		let results: Vec<(usize, u32)> = pages
			.into_par_iter()
			.enumerate()
			.filter_map(|(offset, page)| {
				let page_index = first + offset;
				let block = pending[page_index];
				if block == NONE || context.cancelled.load(Ordering::Relaxed) {
					return None;
				}
				// A page is pending only in a block larger than its sample, whose
				// completion recorded its clusters — at least one, since Stage A
				// puts every sampled page (even one without tokens) in a cluster.
				// So this error marks a broken invariant; keying the page to some
				// made-up cluster instead would hide it.
				let nearest = assignments[block as usize].as_ref().and_then(|assignment| {
					let mut scratch = ScratchVocabulary::default();
					let tokens = assignment_tokens(
						&page.html,
						page.content_root.as_ref(),
						assignment.max_depth,
						assignment.allowed_classes.as_ref(),
						&assignment.local_signatures,
						&mut Ids::Scratch(vocabulary, &mut scratch),
					);
					nearest_cluster(&tokens, &assignment.clusters)
				});
				Some(nearest.map(|key| (page_index, key)).ok_or_else(|| {
					RunError::Protocol(format!(
						"block {block} has no cluster to assign page {page_index} to"
					))
				}))
			})
			.collect::<Result<_, _>>()?;
		context.check()?;

		for (page_index, key) in results {
			self.output.key_of_page[page_index] = key;
			let before = self.assigned;
			self.assigned += 1;
			if self.assigned / ASSIGNED_PER_PROGRESS > before / ASSIGNED_PER_PROGRESS {
				(context.progress)(Progress::Assigned {
					pages_assigned: self.assigned,
					pages_to_assign: self.pending_count,
				});
			}
		}
		if self.assignment_cursor == self.block_of_page.len() {
			self.phase = Phase::Done;
		}
		Ok(())
	}

	/// The result, with the vocabulary its token ids resolve in.
	///
	/// # Errors
	///
	/// [`RunError::Protocol`] when a page was never keyed (pages missing from
	/// a read).
	pub fn into_output(self) -> Result<(Output, Vocabulary), RunError> {
		if let Some(page) = self
			.output
			.key_of_page
			.iter()
			.position(|&key| key == NO_KEY)
		{
			return Err(RunError::Protocol(format!(
				"page {page} was never clustered"
			)));
		}
		Ok((self.output, self.vocabulary))
	}
}

#[cfg(test)]
mod tests {
	use std::sync::Mutex;
	use std::sync::atomic::{AtomicBool, Ordering};

	use super::{
		Context, Mode, PageInput, Progress, Run, RunError, nearest_cluster, sample_blocks,
	};
	use crate::extract_landmarks::LandmarkType;

	/// A member as its tokens read: `(page index, tokens, instances)`.
	type ResolvedMember = (u32, Vec<String>, Vec<(LandmarkType, Vec<String>)>);

	/// An output with its token ids resolved (ids depend on thread timing).
	#[derive(Debug, PartialEq, Eq)]
	struct Resolved {
		key_of_page: Vec<String>,
		units: Vec<(String, u32, Vec<ResolvedMember>)>,
	}

	struct Harness {
		cancelled: AtomicBool,
		events: Mutex<Vec<Progress>>,
		/// Cancel once this many events arrived (a cancel at a known point).
		cancel_after: usize,
	}

	impl Harness {
		fn new() -> Self {
			Self::cancelling_after(usize::MAX)
		}

		fn cancelling_after(events: usize) -> Self {
			Self {
				cancelled: AtomicBool::new(false),
				events: Mutex::new(Vec::new()),
				cancel_after: events,
			}
		}

		fn with<T>(&self, call: impl FnOnce(&Context) -> T) -> T {
			let report = |event: Progress| {
				let mut events = self.events.lock().unwrap();
				events.push(event);
				self.cancelled
					.fetch_or(events.len() >= self.cancel_after, Ordering::Relaxed);
			};
			call(&Context {
				cancelled: &self.cancelled,
				progress: &report,
			})
		}

		fn events(&self) -> Vec<Progress> {
			self.events.lock().unwrap().clone()
		}
	}

	fn inputs(html_list: &[String]) -> Vec<PageInput> {
		html_list
			.iter()
			.map(|html| PageInput {
				html: html.clone(),
				content_root: None,
			})
			.collect()
	}

	/// Two layouts, every third page the second, with a varying class so
	/// pages of a layout are similar but not identical.
	fn corpus(count: usize) -> Vec<String> {
		(0..count)
			.map(|index| {
				if index % 3 == 0 {
					format!(
						"<body><main><table class=\"t{}\"><tr><td>{index}</td></tr></table></main><footer>f</footer></body>",
						index % 2
					)
				} else {
					format!(
						"<body><header><nav>n</nav></header><main><ul class=\"l{}\"><li>{index}</li></ul></main></body>",
						index % 4
					)
				}
			})
			.collect()
	}

	fn resolve(run: Run) -> Resolved {
		let (output, vocabulary) = run.into_output().unwrap();
		let tokens = |ids: &[u32]| -> Vec<String> {
			ids.iter()
				.map(|&id| vocabulary.token(id).to_string())
				.collect()
		};
		Resolved {
			key_of_page: output
				.key_of_page
				.iter()
				.map(|&key| output.keys[key as usize].clone())
				.collect(),
			units: output
				.units
				.iter()
				.map(|unit| {
					(
						output.keys[unit.key as usize].clone(),
						unit.block,
						unit.members
							.iter()
							.map(|member| {
								(
									member.page_index,
									tokens(&member.tokens),
									member
										.instances
										.iter()
										.map(|(kind, ids)| (*kind, tokens(ids)))
										.collect(),
								)
							})
							.collect(),
					)
				})
				.collect(),
		}
	}

	/// `html_list` with every page the mask leaves out blanked.
	fn blank_unused(html_list: &[String], mask: Vec<bool>) -> Vec<String> {
		html_list
			.iter()
			.zip(mask)
			.map(|(html, used)| if used { html.clone() } else { String::new() })
			.collect()
	}

	/// Runs `html_list` through a streaming run with pages outside the
	/// samples, the first read in batches of the given sizes and the
	/// assignment read in one, blanking every page a read leaves out of its
	/// mask.
	fn stream(
		block_keys: &[&str],
		block_of_page: &[u32],
		html_list: &[String],
		sample_size: usize,
		batches: &[usize],
	) -> (Resolved, Vec<Progress>) {
		let harness = Harness::new();
		let mut run = Run::with_sample_size(
			block_keys.iter().map(|key| (*key).to_owned()).collect(),
			block_of_page.to_vec(),
			Mode::Streaming,
			sample_size,
		)
		.unwrap();
		let first = blank_unused(html_list, run.page_mask());
		let mut start = 0;
		for &size in batches {
			let batch = inputs(&first[start..start + size]);
			harness
				.with(|context| run.push_pages(batch, context))
				.unwrap();
			start += size;
		}
		harness.with(|context| run.finish_pages(context)).unwrap();
		assert!(run.needs_assignment());
		let second = inputs(&blank_unused(html_list, run.page_mask()));
		harness
			.with(|context| run.push_assignment_pages(second, context))
			.unwrap();
		assert!(!run.needs_assignment());
		let events = harness.events();
		(resolve(run), events)
	}

	const BLOCK_OF_PAGE: [u32; 12] = [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

	#[test]
	fn samples_each_block_by_algorithm_r_seeded_by_its_key() {
		// Pinned from the TypeScript streaming sampler in `sample_blocks`' doc.
		// As sets they are also what `reservoir_sample_positions` (same PRNG
		// and seed hash, sorted) picks from each block's pages.
		assert_eq!(
			sample_blocks(
				&["path:a".to_owned(), "css:b".to_owned()],
				&BLOCK_OF_PAGE,
				3
			),
			vec![vec![9, 7, 6], vec![1, 4, 8]]
		);
		// Pages 6, 7 and 9 sit at positions 4, 5 and 6 of block a's nine.
		assert_eq!(
			crate::reservoir_sample::reservoir_sample_positions(9, 3, "path:a"),
			vec![4, 5, 6]
		);
	}

	#[test]
	fn masks_the_pages_each_read_uses() {
		let harness = Harness::new();
		let mut run = Run::with_sample_size(
			vec!["path:a".to_owned(), "css:b".to_owned()],
			BLOCK_OF_PAGE.to_vec(),
			Mode::Streaming,
			3,
		)
		.unwrap();
		// Sampled: 1, 4, 6, 7, 8, 9.
		assert_eq!(
			run.page_mask(),
			vec![
				false, true, false, false, true, false, true, true, true, true, false, false
			]
		);
		let html_list = corpus(12);
		harness
			.with(|context| run.push_pages(inputs(&html_list), context))
			.unwrap();
		harness.with(|context| run.finish_pages(context)).unwrap();
		assert_eq!(
			run.page_mask(),
			vec![
				true, false, true, true, false, true, false, false, false, false, true, true
			]
		);
		harness
			.with(|context| run.push_assignment_pages(inputs(&html_list), context))
			.unwrap();
		assert_eq!(run.page_mask(), vec![false; 12]);
	}

	#[test]
	fn masks_every_page_of_an_in_memory_run_until_its_read_ends() {
		let harness = Harness::new();
		let mut run = Run::new(vec!["path:a".to_owned()], vec![0, 0, 0], Mode::InMemory).unwrap();
		assert_eq!(run.page_mask(), vec![true, true, true]);
		harness
			.with(|context| run.push_pages(inputs(&corpus(3)), context))
			.unwrap();
		harness.with(|context| run.finish_pages(context)).unwrap();
		assert_eq!(run.page_mask(), vec![false, false, false]);
		assert!(!run.needs_assignment());
	}

	#[test]
	fn needs_the_assignment_read_only_between_the_two_reads() {
		let harness = Harness::new();
		let mut run = Run::with_sample_size(
			vec!["path:a".to_owned(), "css:b".to_owned()],
			BLOCK_OF_PAGE.to_vec(),
			Mode::Streaming,
			3,
		)
		.unwrap();
		let html_list = corpus(12);
		assert!(!run.needs_assignment());
		harness
			.with(|context| run.push_pages(inputs(&html_list), context))
			.unwrap();
		assert!(!run.needs_assignment());
		harness.with(|context| run.finish_pages(context)).unwrap();
		assert!(run.needs_assignment());
		harness
			.with(|context| run.push_assignment_pages(inputs(&html_list[..6]), context))
			.unwrap();
		assert!(run.needs_assignment());
		harness
			.with(|context| run.push_assignment_pages(inputs(&html_list[6..]), context))
			.unwrap();
		assert!(!run.needs_assignment());
	}

	#[test]
	fn ends_after_the_first_read_when_every_block_fits_its_sample() {
		let harness = Harness::new();
		let mut run = Run::with_sample_size(
			vec!["path:a".to_owned(), "css:b".to_owned()],
			vec![0, 0, 1],
			Mode::Streaming,
			3,
		)
		.unwrap();
		assert_eq!(run.page_mask(), vec![true, true, true]);
		harness
			.with(|context| run.push_pages(inputs(&corpus(3)), context))
			.unwrap();
		harness.with(|context| run.finish_pages(context)).unwrap();
		assert!(!run.needs_assignment());
		assert_eq!(run.page_mask(), vec![false, false, false]);
		assert_eq!(
			protocol(harness.with(|context| run.push_assignment_pages(Vec::new(), context))),
			"the run expects no pages to assign"
		);
		assert_eq!(
			resolve(run).key_of_page,
			// Pages 0 and 1 are the two layouts of `corpus`.
			vec![
				"[\"path:a\",\"cluster:0\"]",
				"[\"path:a\",\"cluster:1\"]",
				"[\"css:b\",\"cluster:0\"]",
			]
		);
	}

	#[test]
	fn rejects_more_pages_to_assign_than_the_corpus_has() {
		let harness = Harness::new();
		let mut run = Run::with_sample_size(
			vec!["path:a".to_owned(), "css:b".to_owned()],
			BLOCK_OF_PAGE.to_vec(),
			Mode::Streaming,
			3,
		)
		.unwrap();
		harness
			.with(|context| run.push_pages(inputs(&corpus(12)), context))
			.unwrap();
		harness.with(|context| run.finish_pages(context)).unwrap();
		assert_eq!(
			protocol(
				harness.with(|context| run.push_assignment_pages(inputs(&corpus(13)), context))
			),
			"received more pages to assign than the corpus has"
		);
	}

	#[test]
	fn assigns_pages_to_a_sample_without_any_tokens() {
		// Every sampled page is put in a cluster, even one with nothing to
		// compare, so the pages outside the sample always have one to join.
		let html_list = vec![String::new(); 4];
		let (resolved, _) = stream(&["path:a"], &[0; 4], &html_list, 2, &[4]);
		assert_eq!(resolved.key_of_page, vec!["[\"path:a\",\"cluster:0\"]"; 4]);
	}

	#[test]
	fn streams_the_same_result_however_the_pages_are_batched() {
		let html_list = corpus(12);
		let keys = ["path:a", "css:b"];
		let (whole, _) = stream(&keys, &BLOCK_OF_PAGE, &html_list, 3, &[12]);
		assert_eq!(
			stream(&keys, &BLOCK_OF_PAGE, &html_list, 3, &[1; 12]).0,
			whole
		);
		assert_eq!(
			stream(&keys, &BLOCK_OF_PAGE, &html_list, 3, &[2, 5, 5]).0,
			whole
		);
		assert_eq!(
			stream(&keys, &BLOCK_OF_PAGE, &html_list, 3, &[5, 7]).0,
			whole
		);
		// Only the sampled pages are members of the units.
		let mut members: Vec<u32> = whole
			.units
			.iter()
			.flat_map(|(_, _, members)| members.iter().map(|member| member.0))
			.collect();
		members.sort_unstable();
		assert_eq!(members, vec![1, 4, 6, 7, 8, 9]);
		// Every page, sampled or assigned, has a key of its own block.
		assert_eq!(
			whole.key_of_page,
			vec![
				"[\"path:a\",\"cluster:2\"]",
				"[\"css:b\",\"cluster:0\"]",
				"[\"path:a\",\"cluster:0\"]",
				"[\"path:a\",\"cluster:0\"]",
				"[\"css:b\",\"cluster:1\"]",
				"[\"path:a\",\"cluster:0\"]",
				"[\"path:a\",\"cluster:2\"]",
				"[\"path:a\",\"cluster:1\"]",
				"[\"css:b\",\"cluster:1\"]",
				"[\"path:a\",\"cluster:0\"]",
				"[\"path:a\",\"cluster:0\"]",
				"[\"path:a\",\"cluster:1\"]",
			]
		);
	}

	#[test]
	fn completes_a_block_in_the_batch_holding_its_last_page() {
		let (_, events) = stream(
			&["path:a", "css:b"],
			&BLOCK_OF_PAGE,
			&corpus(12),
			3,
			&[9, 3],
		);
		assert_eq!(
			events,
			vec![
				Progress::BlockComplete {
					block_key: "css:b".to_owned(),
					blocks_processed: 1,
					total_blocks: 2,
				},
				Progress::BlockComplete {
					block_key: "path:a".to_owned(),
					blocks_processed: 2,
					total_blocks: 2,
				},
			]
		);
	}

	#[test]
	fn reports_assignment_every_thousand_pages() {
		let html_list: Vec<String> = (0..1002)
			.map(|index| format!("<body><p>{index}</p></body>"))
			.collect();
		let (_, events) = stream(&["path:a"], &[0; 1002], &html_list, 1, &[1002]);
		assert_eq!(
			events.last(),
			Some(&Progress::Assigned {
				pages_assigned: 1000,
				pages_to_assign: 1001,
			})
		);
	}

	#[test]
	fn assigns_without_interning_the_assigned_pages_tokens() {
		let harness = Harness::new();
		let mut run =
			Run::with_sample_size(vec!["path:a".to_owned()], vec![0; 5], Mode::Streaming, 4)
				.unwrap();
		let outside = run.page_mask().iter().position(|&used| !used).unwrap();
		let mut html_list = corpus(5);
		html_list[outside] =
			"<body><main><dl class=\"never-sampled\"><dt>x</dt></dl></main></body>".to_owned();
		harness
			.with(|context| run.push_pages(inputs(&html_list), context))
			.unwrap();
		harness.with(|context| run.finish_pages(context)).unwrap();
		harness
			.with(|context| run.push_assignment_pages(inputs(&html_list), context))
			.unwrap();
		assert_eq!(run.vocabulary.classes.get("never-sampled"), None);
		let (output, _) = run.into_output().unwrap();
		assert!(output.key_of_page[outside] < u32::try_from(output.keys.len()).unwrap());
	}

	#[test]
	fn picks_the_cluster_holding_the_most_similar_member() {
		let clusters = vec![(7, vec![vec![1, 2], vec![9]]), (8, vec![vec![1, 2, 3]])];
		assert_eq!(nearest_cluster(&[1, 2, 3], &clusters), Some(8));
		assert_eq!(nearest_cluster(&[9], &clusters), Some(7));
	}

	#[test]
	fn breaks_ties_to_the_earlier_cluster() {
		let clusters = vec![(7, vec![vec![1, 2]]), (8, vec![vec![1, 2]])];
		assert_eq!(nearest_cluster(&[1, 2], &clusters), Some(7));
	}

	#[test]
	fn assigns_a_page_sharing_nothing_to_the_first_cluster() {
		let clusters = vec![(7, vec![vec![1]]), (8, vec![vec![2]])];
		assert_eq!(nearest_cluster(&[3], &clusters), Some(7));
		assert_eq!(nearest_cluster(&[3], &[]), None);
	}

	fn protocol(result: Result<impl Sized, RunError>) -> String {
		match result {
			Err(RunError::Protocol(message)) => message,
			Err(RunError::Cancelled) => panic!("cancelled"),
			Ok(_) => panic!("accepted"),
		}
	}

	#[test]
	fn rejects_blocks_out_of_range_or_without_pages() {
		assert_eq!(
			protocol(Run::new(vec!["a".to_owned()], vec![1], Mode::InMemory)),
			"page block 1 is out of range"
		);
		assert_eq!(
			protocol(Run::new(
				vec!["a".to_owned(), "b".to_owned()],
				vec![0],
				Mode::Streaming
			)),
			"block 1 has no pages"
		);
	}

	#[test]
	fn rejects_calls_out_of_order() {
		let harness = Harness::new();
		let html_list = corpus(3);
		let mut run = Run::new(vec!["a".to_owned()], vec![0; 3], Mode::InMemory).unwrap();
		assert_eq!(
			protocol(
				harness.with(|context| run.push_assignment_pages(inputs(&html_list), context))
			),
			"the run expects no pages to assign"
		);
		assert_eq!(
			protocol(harness.with(|context| run.push_pages(inputs(&corpus(4)), context))),
			"received page 4 of 3"
		);
		harness
			.with(|context| run.push_pages(inputs(&html_list[..2]), context))
			.unwrap();
		assert_eq!(
			protocol(harness.with(|context| run.finish_pages(context))),
			"received 2 pages of 3"
		);
		harness
			.with(|context| run.push_pages(inputs(&html_list[2..]), context))
			.unwrap();
		harness.with(|context| run.finish_pages(context)).unwrap();
		assert_eq!(
			protocol(harness.with(|context| run.finish_pages(context))),
			"the first read already ended"
		);
		assert_eq!(
			protocol(harness.with(|context| run.push_pages(Vec::new(), context))),
			"pages were pushed after the first read ended"
		);
		assert_eq!(
			protocol(harness.with(|context| run.push_assignment_pages(Vec::new(), context))),
			"the run expects no pages to assign"
		);
	}

	#[test]
	fn rejects_an_output_with_unread_pages() {
		let run = Run::new(vec!["a".to_owned()], vec![0; 2], Mode::InMemory).unwrap();
		assert_eq!(protocol(run.into_output()), "page 0 was never clustered");
	}

	#[test]
	fn stops_once_cancelled() {
		let harness = Harness::new();
		let mut run = Run::new(vec!["a".to_owned()], vec![0; 3], Mode::InMemory).unwrap();
		harness.cancelled.store(true, Ordering::Relaxed);
		assert_eq!(
			harness.with(|context| run.push_pages(inputs(&corpus(3)), context)),
			Err(RunError::Cancelled)
		);
	}

	#[test]
	fn stops_streaming_at_the_next_block_once_cancelled() {
		// Cancelled by the first block's event: the second block, completing in
		// the same batch, is not clustered.
		let harness = Harness::cancelling_after(1);
		let mut run = Run::with_sample_size(
			vec!["path:a".to_owned(), "css:b".to_owned()],
			BLOCK_OF_PAGE.to_vec(),
			Mode::Streaming,
			3,
		)
		.unwrap();
		assert_eq!(
			harness.with(|context| run.push_pages(inputs(&corpus(12)), context)),
			Err(RunError::Cancelled)
		);
		assert_eq!(
			harness.events(),
			vec![Progress::BlockComplete {
				block_key: "css:b".to_owned(),
				blocks_processed: 1,
				total_blocks: 2,
			}]
		);
	}

	#[test]
	fn stops_clustering_in_memory_at_the_next_block_once_cancelled() {
		let harness = Harness::cancelling_after(1);
		let mut run = Run::new(
			vec!["path:a".to_owned(), "css:b".to_owned()],
			vec![0, 1, 0, 1],
			Mode::InMemory,
		)
		.unwrap();
		harness
			.with(|context| run.push_pages(inputs(&corpus(4)), context))
			.unwrap();
		assert_eq!(
			harness.with(|context| run.finish_pages(context)),
			Err(RunError::Cancelled)
		);
		assert_eq!(harness.events().len(), 1);
		// Block 0 was clustered, block 1 (pages 1 and 3) never was.
		assert_eq!(protocol(run.into_output()), "page 1 was never clustered");
	}

	#[test]
	fn stops_the_assignment_read_once_cancelled() {
		let harness = Harness::new();
		let mut run = Run::with_sample_size(
			vec!["path:a".to_owned(), "css:b".to_owned()],
			BLOCK_OF_PAGE.to_vec(),
			Mode::Streaming,
			3,
		)
		.unwrap();
		harness
			.with(|context| run.push_pages(inputs(&corpus(12)), context))
			.unwrap();
		harness.with(|context| run.finish_pages(context)).unwrap();
		harness.cancelled.store(true, Ordering::Relaxed);
		assert_eq!(
			harness.with(|context| run.push_assignment_pages(inputs(&corpus(12)), context)),
			Err(RunError::Cancelled)
		);
		assert_eq!(protocol(run.into_output()), "page 0 was never clustered");
	}
}
