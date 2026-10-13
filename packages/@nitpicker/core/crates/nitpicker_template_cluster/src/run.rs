//! One classification run: pages in, Stage A's clusters out.

use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::*;
use rustc_hash::FxHashSet;

use crate::content_root::ContentRoot;
use crate::extract_landmarks::LandmarkType;
use crate::jaccard::{jaccard, sorted_set};
use crate::local_chrome::compute_local_chrome;
use crate::page::{Preparation, PreparedPage, assignment_tokens, prepare_page};
use crate::seeded_random::SeededRandom;
use crate::stage_a::{BlockMember, StageAResult, stage_a};
use crate::vocabulary::{Ids, ScratchVocabulary, Vocabulary};

/// Pages per block a streaming run clusters; the rest of a larger block is
/// assigned to the nearest of those clusters afterwards. Bounds what a run
/// holds per block (and Stage B's input) whatever the corpus size.
pub const BLOCK_SAMPLE_SIZE: usize = 100;

/// One page as the caller reads it.
pub struct PageInput {
	/// The page's HTML.
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
	/// Pages outside the samples were assigned.
	Assigned {
		/// Assigned so far.
		pages_assigned: usize,
		/// To assign in all.
		pages_to_assign: usize,
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
	/// Receives progress events (from any thread).
	pub progress: &'a (dyn Fn(Progress) + Sync),
}

impl Context<'_> {
	fn check(&self) -> Result<(), RunError> {
		if self.cancelled.load(Ordering::Relaxed) {
			Err(RunError::Cancelled)
		} else {
			Ok(())
		}
	}
}

/// One member of a Stage B unit.
#[derive(Debug)]
pub struct UnitMember {
	/// Its index among the run's pages.
	pub page_index: u32,
	/// Its compared tokens, in insertion order.
	pub tokens: Vec<u32>,
	/// Its landmark instances' types and tokens.
	pub instances: Vec<(LandmarkType, Vec<u32>)>,
}

/// One Stage A cluster, as Stage B merges it.
#[derive(Debug)]
pub struct Unit {
	/// Index of its key in [`Output::keys`].
	pub key: u32,
	/// Index of its block in the run's block keys.
	pub block: u32,
	/// Its members (all of them, or the sampled ones when streaming).
	pub members: Vec<UnitMember>,
}

/// Stage A's result for a whole run.
#[derive(Debug, Default)]
pub struct Output {
	/// Every cluster key handed out.
	pub keys: Vec<String>,
	/// Each page's key, as an index into [`Output::keys`].
	pub key_of_page: Vec<u32>,
	/// The units, in block order (streaming: in the order blocks completed).
	pub units: Vec<Unit>,
}

/// Unassigned pages are impossible by construction; this marks a page no
/// key was written for, which the output check turns into an error.
const NO_KEY: u32 = u32::MAX;

/// What a sampled block keeps for assigning its other pages.
struct BlockAssignment {
	max_depth: Option<usize>,
	allowed_classes: Option<FxHashSet<u32>>,
	local_signatures: FxHashSet<Vec<u32>>,
	/// `(key index, members' ascending token sets)`, in cluster order.
	clusters: Vec<(u32, Vec<Vec<u32>>)>,
}

/// A block's reservoir while its pages stream past.
struct Bucket {
	random: SeededRandom,
	seen: usize,
	/// Page indices in the reservoir.
	pages: Vec<u32>,
	/// Their prepared pages, filled at the end of each batch.
	prepared: Vec<Option<PreparedPage>>,
}

/// A run in progress.
pub struct Run {
	vocabulary: Vocabulary,
	block_keys: Vec<String>,
	block_of_page: Vec<u32>,
	block_sizes: Vec<usize>,
	mode: Mode,
	next_page: usize,
	output: Output,
	/// In memory: every page, until its block's Stage A.
	pages: Vec<Option<PreparedPage>>,
	/// Streaming: one reservoir per unfinished block.
	buckets: Vec<Option<Bucket>>,
	blocks_completed: usize,
	/// Streaming: the block a non-sampled page waits to be assigned in.
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
	/// When a page's block index is out of range.
	pub fn new(
		block_keys: Vec<String>,
		block_of_page: Vec<u32>,
		mode: Mode,
	) -> Result<Self, RunError> {
		let mut block_sizes = vec![0usize; block_keys.len()];
		for &block in &block_of_page {
			*block_sizes.get_mut(block as usize).ok_or_else(|| {
				RunError::Protocol(format!("page block {block} is out of range"))
			})? += 1;
		}
		let page_count = block_of_page.len();
		let block_count = block_keys.len();
		Ok(Self {
			vocabulary: Vocabulary::default(),
			buckets: match mode {
				Mode::InMemory => Vec::new(),
				Mode::Streaming => block_keys
					.iter()
					.map(|key| {
						Some(Bucket {
							random: SeededRandom::from_key(key),
							seen: 0,
							pages: Vec::new(),
							prepared: Vec::new(),
						})
					})
					.collect(),
			},
			block_keys,
			block_of_page,
			block_sizes,
			mode,
			next_page: 0,
			output: Output {
				keys: Vec::new(),
				key_of_page: vec![NO_KEY; page_count],
				units: Vec::new(),
			},
			pages: Vec::new(),
			blocks_completed: 0,
			pending_block_of_page: Vec::new(),
			pending_count: 0,
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

	/// Reads the next pages (in corpus order).
	///
	/// # Errors
	///
	/// [`RunError::Cancelled`], or [`RunError::Protocol`] past the last page.
	pub fn push_pages(&mut self, pages: Vec<PageInput>, context: &Context) -> Result<(), RunError> {
		context.check()?;
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
		if self.pending_block_of_page.is_empty() {
			self.pending_block_of_page = vec![u32::MAX; self.block_of_page.len()];
		}
		// Sampling decisions first, in page order (Algorithm R per block, as
		// the stored keys were sampled); only pages still in a reservoir at
		// the end of the batch — or when their block completes — are read.
		let mut slot_of_page: Vec<Option<(usize, usize)>> = vec![None; pages.len()];
		let mut completed: Vec<usize> = Vec::new();
		for offset in 0..pages.len() {
			let page_index = first + offset;
			let block = self.block_of_page[page_index] as usize;
			let target = self.block_sizes[block];
			let bucket = self.buckets[block].as_mut().ok_or_else(|| {
				RunError::Protocol(format!("block {block} received a page after it completed"))
			})?;
			let page_index_u32 = u32::try_from(page_index).expect("fewer than 2^32 pages");
			if bucket.pages.len() < BLOCK_SAMPLE_SIZE {
				bucket.pages.push(page_index_u32);
				bucket.prepared.push(None);
				slot_of_page[offset] = Some((block, bucket.pages.len() - 1));
			} else {
				// `floor(random * (seen + 1))`, exactly as JavaScript computes it.
				#[allow(
					clippy::cast_possible_truncation,
					clippy::cast_sign_loss,
					clippy::cast_precision_loss
				)]
				let slot = (bucket.random.next_f64() * (bucket.seen + 1) as f64).floor() as usize;
				if slot < BLOCK_SAMPLE_SIZE {
					let evicted = bucket.pages[slot];
					self.pending_block_of_page[evicted as usize] =
						u32::try_from(block).expect("block fits");
					self.pending_count += 1;
					if let Some(evicted_offset) = (evicted as usize).checked_sub(first) {
						slot_of_page[evicted_offset] = None;
					}
					bucket.pages[slot] = page_index_u32;
					bucket.prepared[slot] = None;
					slot_of_page[offset] = Some((block, slot));
				} else {
					self.pending_block_of_page[page_index] =
						u32::try_from(block).expect("block fits");
					self.pending_count += 1;
				}
			}
			bucket.seen += 1;
			if bucket.seen == target {
				completed.push(block);
			}
		}

		let block_sizes = &self.block_sizes;
		let vocabulary = &self.vocabulary;
		let read: Vec<(usize, usize, PreparedPage)> = pages
			.into_par_iter()
			.zip(slot_of_page)
			.filter_map(|(page, slot)| {
				let (block, slot) = slot?;
				if context.cancelled.load(Ordering::Relaxed) {
					return None;
				}
				let sample = block_sizes[block].min(BLOCK_SAMPLE_SIZE);
				let prepared = prepare_page(
					&page.html,
					page.content_root.as_ref(),
					Self::preparation(sample),
					&mut Ids::Shared(vocabulary),
				);
				Some((block, slot, prepared))
			})
			.collect();
		context.check()?;
		for (block, slot, prepared) in read {
			let bucket = self.buckets[block]
				.as_mut()
				.expect("a block being read is unfinished");
			bucket.prepared[slot] = Some(prepared);
		}

		for block in completed {
			context.check()?;
			let bucket = self.buckets[block]
				.take()
				.expect("a completing block is unfinished");
			self.flush_block(block, &bucket);
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

	fn flush_block(&mut self, block: usize, bucket: &Bucket) {
		let pages: Vec<&PreparedPage> = bucket
			.prepared
			.iter()
			.map(|page| page.as_ref().expect("every reservoir page was read"))
			.collect();
		let instances: Vec<&[crate::page::LandmarkInstance]> =
			pages.iter().map(|page| page.instances.as_slice()).collect();
		let chrome = compute_local_chrome(&instances);
		let members: Vec<BlockMember> = pages
			.iter()
			.zip(&chrome.tokens_by_page)
			.map(|(page, local_tokens)| BlockMember { page, local_tokens })
			.collect();
		let result = stage_a(&self.block_keys[block], &members, &self.vocabulary);
		let key_indices = self.record_block(block, &bucket.pages, &pages, &result);

		if bucket.seen > bucket.pages.len() {
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
	/// missing.
	///
	/// # Panics
	///
	/// Never once every page was read, which the page count check
	/// establishes first.
	pub fn finish_pages(&mut self, context: &Context) -> Result<(), RunError> {
		if self.next_page != self.block_of_page.len() {
			return Err(RunError::Protocol(format!(
				"received {} pages of {}",
				self.next_page,
				self.block_of_page.len()
			)));
		}
		if self.mode == Mode::Streaming {
			if self.buckets.iter().any(Option::is_some) {
				return Err(RunError::Protocol(
					"a block never reached its size".to_owned(),
				));
			}
			return Ok(());
		}

		let mut pages = std::mem::take(&mut self.pages);
		let chrome = {
			let instances: Vec<&[crate::page::LandmarkInstance]> = pages
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
		Ok(())
	}

	/// Whether a streaming run has pages to assign (a second read).
	#[must_use]
	pub fn needs_assignment(&self) -> bool {
		self.pending_count > 0
	}

	/// Assigns the next pages of the second read (in corpus order; pages
	/// that were sampled are skipped) to the nearest cluster of their block:
	/// the highest Jaccard similarity to any sampled member, ties to the
	/// earlier cluster.
	///
	/// # Errors
	///
	/// [`RunError::Cancelled`], or [`RunError::Protocol`] past the last page.
	pub fn push_assignment_pages(
		&mut self,
		pages: Vec<PageInput>,
		context: &Context,
	) -> Result<(), RunError> {
		context.check()?;
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
		let results: Vec<(usize, Option<u32>)> = pages
			.into_par_iter()
			.enumerate()
			.filter_map(|(offset, page)| {
				let page_index = first + offset;
				let block = *pending.get(page_index)?;
				if block == u32::MAX || context.cancelled.load(Ordering::Relaxed) {
					return None;
				}
				let Some(assignment) = assignments[block as usize].as_ref() else {
					return Some((page_index, None));
				};
				let mut scratch = ScratchVocabulary::default();
				let tokens = assignment_tokens(
					&page.html,
					page.content_root.as_ref(),
					assignment.max_depth,
					assignment.allowed_classes.as_ref(),
					&assignment.local_signatures,
					&mut Ids::Scratch(vocabulary, &mut scratch),
				);
				let mut best: Option<u32> = None;
				let mut best_score = -1.0;
				for (key, members) in &assignment.clusters {
					let mut cluster_best = 0.0;
					for member in members {
						let score = jaccard(&tokens, member);
						if score > cluster_best {
							cluster_best = score;
						}
					}
					if cluster_best > best_score {
						best_score = cluster_best;
						best = Some(*key);
					}
				}
				Some((page_index, best))
			})
			.collect();
		context.check()?;

		for (page_index, best) in results {
			let block = self.pending_block_of_page[page_index] as usize;
			let key = match best {
				Some(key) => key,
				None => self.add_key(format!(
					"[{},\"cluster:unassigned\"]",
					crate::js_string::json_string(&self.block_keys[block])
				)),
			};
			self.output.key_of_page[page_index] = key;
			let before = self.assigned;
			self.assigned += 1;
			if self.assigned / 1000 > before / 1000 {
				(context.progress)(Progress::Assigned {
					pages_assigned: self.assigned,
					pages_to_assign: self.pending_count,
				});
			}
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
