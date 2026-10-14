//! Everything the classifier derives from one page's HTML.

use std::ops::Range;
use std::sync::Arc;

use nitpicker_html_parser::{Document, parse};
use rustc_hash::FxHashSet;

use crate::collect_deep_spans::collect_deep_spans;
use crate::content_root::{ContentRoot, find_content_root};
use crate::detect_content_depth_cap::CANDIDATE_DEPTHS;
use crate::excise::excise;
use crate::extract_landmarks::{LandmarkType, Landmarks, extract_landmarks};
use crate::jaccard::sorted_set;
use crate::skip_ranges::skip_ranges;
use crate::tokenize::{ReplayCache, Tokenized, tokenize, tokenize_events};
use crate::vocabulary::Ids;

/// One landmark region of a page, tokenized on its own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LandmarkInstance {
	/// Its type.
	pub kind: LandmarkType,
	/// Its tokens, in document order.
	pub tokens: Vec<u32>,
}

impl LandmarkInstance {
	/// Its token set, ascending: equal for instances with equal token sets.
	///
	/// Worked out per call rather than kept beside [`LandmarkInstance::tokens`]:
	/// a page holds its instances until its block is clustered, and the
	/// signature would be a second copy of the tokens.
	#[must_use]
	pub fn signature(&self) -> Vec<u32> {
		sorted_set(&self.tokens)
	}
}

/// Each landmark instance's tokens (the instance's markup wrapped in a
/// `<body>`), skipping instances without tokens and, within the page,
/// instances whose token set repeats an earlier one (a duplicated footer,
/// one element matching two types) — so none counts twice. Each comes with
/// its signature, for a caller that compares it at once.
fn landmark_instances(
	html: &str,
	landmarks: &Landmarks,
	ids: &mut Ids,
) -> Vec<(LandmarkInstance, Vec<u32>)> {
	let mut instances: Vec<(LandmarkInstance, Vec<u32>)> = Vec::new();
	let mut seen: FxHashSet<Vec<u32>> = FxHashSet::default();
	for (kind, range) in &landmarks.instances {
		let wrapped = format!("<body>{}</body>", &html[range.clone()]);
		let tokens = tokenize(&wrapped, None, ids).tokens;
		if tokens.is_empty() {
			continue;
		}
		let signature = sorted_set(&tokens);
		if !seen.insert(signature.clone()) {
			continue;
		}
		instances.push((
			LandmarkInstance {
				kind: *kind,
				tokens,
			},
			signature,
		));
	}
	instances
}

/// The tokens of `prepared` with `spans` cut out: a replay of its parse
/// with the spans' events skipped where that is provably the same (see
/// `skip_ranges`), else a parse of the cut markup.
fn tokens_without(
	prepared: &str,
	document: &Document,
	spans: &[Range<usize>],
	allowed: Option<&FxHashSet<u32>>,
	cache: &mut ReplayCache,
	ids: &mut Ids,
) -> Tokenized {
	if let Some(ranges) = skip_ranges(prepared, document, spans)
		&& let Some(tokenized) = tokenize_events(prepared, document, &ranges, allowed, cache, ids)
	{
		return tokenized;
	}
	tokenize(&excise(prepared, spans), allowed, ids)
}

/// A page's tokens across the content-depth candidates.
#[derive(Debug)]
pub enum DepthTokens {
	/// The same at every depth: no content root, or a single-page block
	/// (which never caps).
	Uncapped(Tokenized),
	/// One entry per [`CANDIDATE_DEPTHS`] entry. Depths that cut the same
	/// spans (a page with nothing below the shallower depth cuts the same
	/// at every deeper one) share one allocation.
	ByDepth(Vec<Arc<Tokenized>>),
	/// Dropped by [`PreparedPage::release_tokens`]: the block's comparison
	/// sets are built and nothing reads the tokens again.
	Released,
}

/// `depth_spans` with each entry that equals an earlier one pointing at
/// that one's allocation.
fn share_equal_spans(depth_spans: Vec<Vec<Range<usize>>>) -> Vec<Arc<[Range<usize>]>> {
	let mut shared: Vec<Arc<[Range<usize>]>> = Vec::with_capacity(depth_spans.len());
	for spans in depth_spans {
		let earlier = shared
			.iter()
			.find(|earlier| earlier.as_ref() == spans.as_slice());
		let next = match earlier {
			Some(earlier) => Arc::clone(earlier),
			None => Arc::from(spans),
		};
		shared.push(next);
	}
	shared
}

impl DepthTokens {
	/// The tokens at `CANDIDATE_DEPTHS[depth_index]`, or uncapped.
	///
	/// # Panics
	///
	/// When asked for no depth on a page that was swept: a swept block always
	/// chooses one. Also after [`PreparedPage::release_tokens`]: Stage A
	/// releases a block's pages once, after its comparison sets are built,
	/// and a block is clustered once.
	#[must_use]
	pub fn at(&self, depth_index: Option<usize>) -> &Tokenized {
		match (self, depth_index) {
			(Self::Uncapped(tokens), _) => tokens,
			(Self::ByDepth(by_depth), Some(index)) => by_depth[index].as_ref(),
			(Self::ByDepth(_), None) => unreachable!("a swept block always chooses a depth"),
			(Self::Released, _) => unreachable!("released tokens are not read"),
		}
	}
}

/// What Stage A keeps of a page between reading it and clustering its block.
#[derive(Debug)]
pub struct PreparedPage {
	/// Its landmark instances.
	pub instances: Vec<LandmarkInstance>,
	/// Its tokens per candidate depth.
	pub depth_tokens: DepthTokens,
	/// The page with its landmarks cut out, and the cut for each candidate
	/// depth — kept only when the block will be tokenized a second time
	/// with page-unique classes stripped.
	pub retained: Option<RetainedMarkup>,
}

/// See [`PreparedPage::retained`].
///
/// The markup is held LZ4-compressed (HTML shrinks to a third or less):
/// it is the largest thing a page keeps until its block is clustered, and
/// it is read once more, by [`PreparedPage::tokens_with_allowed_classes`].
#[derive(Debug)]
pub struct RetainedMarkup {
	compressed: Vec<u8>,
	depth_spans: Option<Vec<Arc<[Range<usize>]>>>,
}

/// How a page's block will use it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Preparation {
	/// Its block has more than one page, so its depth cap is swept.
	pub sweep: bool,
	/// Its block is big enough to strip page-unique classes, which needs
	/// the markup again.
	pub retain_markup: bool,
}

/// Reads one page: its landmarks (cut out of the markup that is compared),
/// and its tokens at every candidate content depth.
///
/// One parse of the landmark-free markup serves every depth: each depth's
/// cut is replayed as skipped events (see [`tokens_without`]) instead of
/// cutting and re-parsing the markup once per depth.
pub fn prepare_page(
	html: &str,
	hint: Option<&ContentRoot>,
	preparation: Preparation,
	ids: &mut Ids,
) -> PreparedPage {
	let landmarks = extract_landmarks(html, &parse(html));
	let instances = landmark_instances(html, &landmarks, ids)
		.into_iter()
		.map(|(instance, _)| instance)
		.collect();
	let prepared = landmarks.remainder;
	let document = parse(&prepared);
	let mut cache = ReplayCache::default();

	let content = if preparation.sweep {
		find_content_root(&prepared, &document, hint)
	} else {
		None
	};
	let depth_spans = content.map(|content| {
		share_equal_spans(collect_deep_spans(&prepared, content, &CANDIDATE_DEPTHS))
	});
	let depth_tokens = match &depth_spans {
		Some(depth_spans) => {
			let mut by_depth: Vec<Arc<Tokenized>> = Vec::with_capacity(depth_spans.len());
			for (depth, spans) in depth_spans.iter().enumerate() {
				let same_cut = depth_spans[..depth]
					.iter()
					.position(|earlier| Arc::ptr_eq(earlier, spans));
				let tokenized = match same_cut {
					Some(earlier) => Arc::clone(&by_depth[earlier]),
					None => Arc::new(tokens_without(
						&prepared, &document, spans, None, &mut cache, ids,
					)),
				};
				by_depth.push(tokenized);
			}
			DepthTokens::ByDepth(by_depth)
		}
		None => DepthTokens::Uncapped(tokens_without(
			&prepared,
			&document,
			&[],
			None,
			&mut cache,
			ids,
		)),
	};
	PreparedPage {
		instances,
		depth_tokens,
		retained: preparation.retain_markup.then(|| RetainedMarkup {
			compressed: lz4_flex::compress_prepend_size(prepared.as_bytes()),
			depth_spans,
		}),
	}
}

impl PreparedPage {
	/// Drops what only the block's comparison sets are built from — the
	/// tokens at every depth and the retained markup — keeping the landmark
	/// instances, which Stage B still needs.
	///
	/// Called once Stage A has built its comparison sets, so the quadratic
	/// work that follows does not hold every page's parse results beside it.
	pub fn release_tokens(&mut self) {
		self.depth_tokens = DepthTokens::Released;
		self.retained = None;
	}

	/// The page's tokens at `CANDIDATE_DEPTHS[depth_index]` (or uncapped)
	/// keeping only the classes in `allowed`.
	///
	/// # Panics
	///
	/// When the page was prepared without [`Preparation::retain_markup`], or
	/// after [`PreparedPage::release_tokens`].
	pub fn tokens_with_allowed_classes(
		&self,
		depth_index: Option<usize>,
		allowed: &FxHashSet<u32>,
		ids: &mut Ids,
	) -> Tokenized {
		let retained = self
			.retained
			.as_ref()
			.expect("a page tokenized twice is prepared with its markup");
		let spans: &[Range<usize>] = match (&retained.depth_spans, depth_index) {
			(Some(depth_spans), Some(index)) => &depth_spans[index],
			_ => &[],
		};
		let prepared = String::from_utf8(
			lz4_flex::decompress_size_prepended(&retained.compressed)
				.expect("the markup was compressed by `prepare_page`"),
		)
		.expect("the markup was compressed from a `String`");
		let document = parse(&prepared);
		tokens_without(
			&prepared,
			&document,
			spans,
			Some(allowed),
			&mut ReplayCache::default(),
			ids,
		)
	}
}

/// What assigning a page to a sampled block's clusters needs of it: its
/// tokens capped at the block's depth with the block's classes, plus the
/// tokens of those of its landmark instances the block counts as local
/// chrome. As an ascending set; the page itself is not kept.
pub fn assignment_tokens(
	html: &str,
	hint: Option<&ContentRoot>,
	max_depth: Option<usize>,
	allowed: Option<&FxHashSet<u32>>,
	local_signatures: &FxHashSet<Vec<u32>>,
	ids: &mut Ids,
) -> Vec<u32> {
	let landmarks = extract_landmarks(html, &parse(html));
	let prepared = &landmarks.remainder;
	let document = parse(prepared);
	let spans = match max_depth {
		Some(max_depth) => find_content_root(prepared, &document, hint)
			.map(|content| collect_deep_spans(prepared, content, &[max_depth]).remove(0))
			.unwrap_or_default(),
		None => Vec::new(),
	};
	let mut tokens = tokens_without(
		prepared,
		&document,
		&spans,
		allowed,
		&mut ReplayCache::default(),
		ids,
	)
	.tokens;
	if !local_signatures.is_empty() {
		for (instance, signature) in landmark_instances(html, &landmarks, ids) {
			if local_signatures.contains(&signature) {
				tokens.extend(instance.tokens);
			}
		}
	}
	sorted_set(&tokens)
}

#[cfg(test)]
mod tests {
	use std::path::{Path, PathBuf};
	use std::sync::Arc;

	use nitpicker_html_parser::parse;
	use rustc_hash::FxHashSet;

	use super::{DepthTokens, Preparation, prepare_page};
	use crate::collect_deep_spans::collect_deep_spans;
	use crate::content_root::find_content_root;
	use crate::detect_content_depth_cap::CANDIDATE_DEPTHS;
	use crate::excise::excise;
	use crate::extract_landmarks::extract_landmarks;
	use crate::skip_ranges::skip_ranges;
	use crate::tokenize::{ReplayCache, tokenize, tokenize_events};
	use crate::vocabulary::{Ids, Vocabulary};

	fn html_files(directory: &Path, files: &mut Vec<PathBuf>) {
		for entry in std::fs::read_dir(directory).unwrap() {
			let path = entry.unwrap().path();
			if path.is_dir() {
				html_files(&path, files);
			} else if path
				.extension()
				.is_some_and(|extension| extension == "html")
			{
				files.push(path);
			}
		}
	}

	/// Every fixture whole and cut short at seven points (on char
	/// boundaries), so unclosed elements and cuts inside tags are covered.
	fn corpus() -> Vec<(String, String)> {
		// The fixtures live with the classifier's tests in `@nitpicker/archive`.
		let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"))
			.join("../../../archive/src/template-classification/page-cluster/__fixtures__");
		let mut files = Vec::new();
		html_files(&fixtures, &mut files);
		files.sort();
		let mut corpus = Vec::new();
		for file in files {
			let html = std::fs::read_to_string(&file).unwrap();
			let chars = html.chars().count();
			for eighth in 1..8 {
				let cut: String = html.chars().take(chars * eighth / 8).collect();
				corpus.push((format!("{} ({eighth}/8)", file.display()), cut));
			}
			corpus.push((file.display().to_string(), html));
		}
		corpus
	}

	#[test]
	fn shares_the_tokens_of_depths_that_cut_the_same_spans() {
		let vocabulary = Vocabulary::default();
		let preparation = Preparation {
			sweep: true,
			retain_markup: true,
		};
		// Nothing below level 2, so no depth cuts anything.
		let shallow = prepare_page(
			"<body><main><p>a</p><p>b</p></main></body>",
			None,
			preparation,
			&mut Ids::Shared(&vocabulary),
		);
		let DepthTokens::ByDepth(by_depth) = &shallow.depth_tokens else {
			panic!("a swept page with a content root is tokenized per depth");
		};
		assert_eq!(by_depth.len(), CANDIDATE_DEPTHS.len());
		assert!(
			by_depth
				.iter()
				.all(|tokens| Arc::ptr_eq(tokens, &by_depth[0]))
		);

		// A chain deeper than the deepest candidate is cut differently by every one.
		let levels = CANDIDATE_DEPTHS[CANDIDATE_DEPTHS.len() - 1] + 2;
		let chain = format!(
			"<body><main>{}x{}</main></body>",
			"<div>".repeat(levels),
			"</div>".repeat(levels)
		);
		let deep = prepare_page(&chain, None, preparation, &mut Ids::Shared(&vocabulary));
		let DepthTokens::ByDepth(by_depth) = &deep.depth_tokens else {
			panic!("a swept page with a content root is tokenized per depth");
		};
		for (first, second) in by_depth.iter().zip(by_depth.iter().skip(1)) {
			assert!(!Arc::ptr_eq(first, second));
		}
	}

	#[test]
	fn keeps_its_landmark_instances_when_the_tokens_are_released() {
		let vocabulary = Vocabulary::default();
		let preparation = Preparation {
			sweep: true,
			retain_markup: true,
		};
		let mut page = prepare_page(
			"<body><nav><a>x</a></nav><main><p>a</p></main></body>",
			None,
			preparation,
			&mut Ids::Shared(&vocabulary),
		);
		let instances = page.instances.clone();
		assert!(!instances.is_empty());
		assert!(page.retained.is_some());
		page.release_tokens();
		assert_eq!(page.instances, instances);
		assert!(page.retained.is_none());
		assert!(matches!(page.depth_tokens, DepthTokens::Released));
	}

	/// Where the replay claims to apply, it must give exactly what parsing
	/// the cut markup gives — the guarantee `tokens_without` relies on.
	#[test]
	fn replays_every_depth_cut_exactly_as_a_reparse_would() {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		let no_classes = FxHashSet::default();
		let (mut replayed, mut reparsed) = (0usize, 0usize);
		for (name, html) in corpus() {
			let prepared = extract_landmarks(&html, &parse(&html)).remainder;
			let document = parse(&prepared);
			let Some(content) = find_content_root(&prepared, &document, None) else {
				continue;
			};
			let mut cache = ReplayCache::default();
			for (depth, spans) in collect_deep_spans(&prepared, content, &CANDIDATE_DEPTHS)
				.iter()
				.enumerate()
			{
				let cut = excise(&prepared, spans);
				for allowed in [None, Some(&no_classes)] {
					let replay = skip_ranges(&prepared, &document, spans).and_then(|ranges| {
						tokenize_events(
							&prepared, &document, &ranges, allowed, &mut cache, &mut ids,
						)
					});
					let Some(replay) = replay else {
						reparsed += 1;
						continue;
					};
					replayed += 1;
					assert_eq!(
						replay,
						tokenize(&cut, allowed, &mut ids),
						"{name} at depth {}",
						CANDIDATE_DEPTHS[depth]
					);
				}
			}
		}
		// The replay is the fast path: it must stay the common one, and enough
		// cuts must be compared for the equality above to mean something.
		assert!(
			replayed > reparsed * 4 && replayed >= 1000,
			"replayed {replayed}, reparsed {reparsed}"
		);
	}
}
