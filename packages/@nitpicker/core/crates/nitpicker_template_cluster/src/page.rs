//! Everything the classifier derives from one page's HTML.

use std::ops::Range;

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
	/// Its token set, ascending: equal for instances with equal token sets.
	pub signature: Vec<u32>,
}

/// Each landmark instance's tokens (the instance's markup wrapped in a
/// `<body>`), skipping instances without tokens and, within the page,
/// instances whose token set repeats an earlier one (a duplicated footer,
/// one element matching two types) — so none counts twice.
fn landmark_instances(html: &str, landmarks: &Landmarks, ids: &mut Ids) -> Vec<LandmarkInstance> {
	let mut instances: Vec<LandmarkInstance> = Vec::new();
	for (kind, range) in &landmarks.instances {
		let wrapped = format!("<body>{}</body>", &html[range.clone()]);
		let tokens = tokenize(&wrapped, None, ids).tokens;
		if tokens.is_empty() {
			continue;
		}
		let signature = sorted_set(&tokens);
		if instances
			.iter()
			.any(|instance| instance.signature == signature)
		{
			continue;
		}
		instances.push(LandmarkInstance {
			kind: *kind,
			tokens,
			signature,
		});
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
	/// One entry per [`CANDIDATE_DEPTHS`] entry.
	ByDepth(Vec<Tokenized>),
}

impl DepthTokens {
	/// The tokens at `CANDIDATE_DEPTHS[depth_index]`, or uncapped.
	///
	/// # Panics
	///
	/// When asked for no depth on a page that was swept: a swept block always
	/// chooses one.
	#[must_use]
	pub fn at(&self, depth_index: Option<usize>) -> &Tokenized {
		match (self, depth_index) {
			(Self::Uncapped(tokens), _) => tokens,
			(Self::ByDepth(by_depth), Some(index)) => &by_depth[index],
			(Self::ByDepth(_), None) => unreachable!("a swept block always chooses a depth"),
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
#[derive(Debug)]
pub struct RetainedMarkup {
	prepared: String,
	depth_spans: Option<Vec<Vec<Range<usize>>>>,
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
/// cut is replayed as skipped events (see [`tokens_without`]), where the
/// JavaScript this replaces cut and re-parsed the markup once per depth.
pub fn prepare_page(
	html: &str,
	hint: Option<&ContentRoot>,
	preparation: Preparation,
	ids: &mut Ids,
) -> PreparedPage {
	let landmarks = extract_landmarks(html, &parse(html));
	let instances = landmark_instances(html, &landmarks, ids);
	let prepared = landmarks.remainder;
	let document = parse(&prepared);
	let mut cache = ReplayCache::default();

	let content = if preparation.sweep {
		find_content_root(&prepared, &document, hint)
	} else {
		None
	};
	let depth_spans =
		content.map(|content| collect_deep_spans(&prepared, content, &CANDIDATE_DEPTHS));
	let depth_tokens = match &depth_spans {
		Some(depth_spans) => DepthTokens::ByDepth(
			depth_spans
				.iter()
				.map(|spans| tokens_without(&prepared, &document, spans, None, &mut cache, ids))
				.collect(),
		),
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
		retained: preparation.retain_markup.then_some(RetainedMarkup {
			prepared,
			depth_spans,
		}),
	}
}

impl PreparedPage {
	/// The page's tokens at `CANDIDATE_DEPTHS[depth_index]` (or uncapped)
	/// keeping only the classes in `allowed`.
	///
	/// # Panics
	///
	/// When the page was prepared without [`Preparation::retain_markup`].
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
		let document = parse(&retained.prepared);
		tokens_without(
			&retained.prepared,
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
		for instance in landmark_instances(html, &landmarks, ids) {
			if local_signatures.contains(&instance.signature) {
				tokens.extend(instance.tokens);
			}
		}
	}
	sorted_set(&tokens)
}
