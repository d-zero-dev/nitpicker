use rustc_hash::FxHashSet;

use crate::complete_linkage_dendrogram::{complete_linkage_dendrogram, labels_at_threshold};
use crate::derive_comparison_sets::derive_comparison_sets;

/// The content-root depths tried, ascending.
///
/// Starts at 2: depth 1 keeps a handful of tokens per page, so list and
/// detail pages read as the same template (measured on a ~1,800-page crawl
/// without `<main>`: 48 clusters at depth 1 against 50 from 2; starting at
/// 3, or requiring a 2× jump, fragmented one section's freeform pages). The
/// cost: a block whose freeform content starts at depth 2 shows no knee and
/// stays uncapped.
pub const CANDIDATE_DEPTHS: [usize; 7] = [2, 3, 4, 5, 6, 8, 10];

/// The cluster-count ratio between consecutive depths that counts as the
/// knee: a 50 % jump.
const MIN_KNEE_RATIO: f64 = 1.5;

/// The similarity at which the sweep counts clusters.
const SWEEP_SIMILARITY_THRESHOLD: f64 = 0.8;

/// How many clusters `sets` (one ascending id list per page) form at the
/// sweep's fixed threshold.
fn cluster_count(sets: &[Vec<u32>]) -> usize {
	if sets.is_empty() {
		return 0;
	}
	let comparison = derive_comparison_sets(sets);
	let merges = complete_linkage_dendrogram(&comparison);
	labels_at_threshold(comparison.len(), &merges, SWEEP_SIMILARITY_THRESHOLD)
		.into_iter()
		.collect::<FxHashSet<usize>>()
		.len()
}

/// Picks the content-depth cap of a block from its pages' token sets at
/// each of [`CANDIDATE_DEPTHS`] (`sets_by_depth[d][page]`).
///
/// The cluster count stays flat while the cap keeps only template skeleton
/// and jumps once it lets freeform editorial content in (14× and 9× on two
/// unrelated crawls, both at depth 3). The depth just before the largest
/// jump of at least [`MIN_KNEE_RATIO`] is returned; with no such jump the
/// deepest candidate is (no cap rather than a guess). Depths are counted one
/// after another rather than in parallel: each holds an `n²/2` similarity
/// table (`d²/2` for `d` distinct sets, as identical ones are folded; itself
/// filled in parallel), the largest allocation of the run.
#[must_use]
pub fn detect_content_depth_cap(sets_by_depth: &[Vec<Vec<u32>>]) -> usize {
	let counts: Vec<usize> = sets_by_depth
		.iter()
		.map(|sets| cluster_count(sets))
		.collect();

	let mut best_ratio = f64::NEG_INFINITY;
	let mut knee: Option<usize> = None;
	for index in 1..counts.len() {
		let (previous, current) = (counts[index - 1], counts[index]);
		if previous == 0 {
			continue;
		}
		// Cluster counts stay far below 2^52; the conversions are exact.
		#[allow(clippy::cast_precision_loss)]
		let ratio = current as f64 / previous as f64;
		if ratio >= MIN_KNEE_RATIO && ratio > best_ratio {
			best_ratio = ratio;
			knee = Some(index);
		}
	}
	match knee {
		Some(index) => CANDIDATE_DEPTHS[index - 1],
		None => CANDIDATE_DEPTHS[CANDIDATE_DEPTHS.len() - 1],
	}
}

#[cfg(test)]
mod tests {
	use super::{CANDIDATE_DEPTHS, detect_content_depth_cap};
	use crate::content_root::ContentRoot;
	use crate::jaccard::sorted_set;
	use crate::page::{Preparation, prepare_page};
	use crate::vocabulary::{Ids, Vocabulary};

	/// Each page's token set at every candidate depth, as the block sweep
	/// reads them: `[depth][page]`.
	fn sets_by_depth(pages: &[String], hints: &[Option<ContentRoot>]) -> Vec<Vec<Vec<u32>>> {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		let preparation = Preparation {
			sweep: true,
			retain_markup: false,
		};
		let prepared: Vec<_> = pages
			.iter()
			.enumerate()
			.map(|(index, html)| {
				let hint = hints.get(index).and_then(Option::as_ref);
				prepare_page(html, hint, preparation, &mut ids)
			})
			.collect();
		(0..CANDIDATE_DEPTHS.len())
			.map(|depth| {
				prepared
					.iter()
					.map(|page| sorted_set(&page.depth_tokens.at(Some(depth)).tokens))
					.collect()
			})
			.collect()
	}

	fn page_hint() -> ContentRoot {
		ContentRoot {
			id: Some("page".to_owned()),
			..ContentRoot::default()
		}
	}

	const TAGS: [&str; 10] = [
		"em", "strong", "b", "i", "u", "code", "kbd", "samp", "var", "mark",
	];

	fn distinct(pages: usize, offset: u32) -> Vec<Vec<u32>> {
		(0..pages)
			.map(|page| vec![1, offset + u32::try_from(page).unwrap()])
			.collect()
	}

	#[test]
	fn returns_the_depth_before_the_biggest_jump() {
		let same: Vec<Vec<u32>> = (0..4).map(|_| vec![1, 2]).collect();
		let sets = vec![
			same.clone(),
			same.clone(),
			distinct(4, 100),
			distinct(4, 200),
			distinct(4, 300),
			distinct(4, 400),
			distinct(4, 500),
		];
		assert_eq!(detect_content_depth_cap(&sets), 3);
	}

	#[test]
	fn returns_the_deepest_candidate_without_a_knee() {
		let same: Vec<Vec<u32>> = (0..4).map(|_| vec![1, 2]).collect();
		assert_eq!(detect_content_depth_cap(&vec![same; 7]), 10);
	}

	#[test]
	fn finds_the_depth_just_before_the_cluster_count_explodes() {
		// Depths 2 and 3 fold to one cluster (the wrapper down to the <div>
		// is identical on every page); depth 4 admits a page-unique
		// <span class="unique-N">, fragmenting all 20 pages apart.
		let pages: Vec<String> = (0..20)
			.map(|i| {
				format!(
					"<body><main><section><article><div><span class=\"unique-{i}\">content</span></div></article></section></main></body>"
				)
			})
			.collect();
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&pages, &[])), 3);
	}

	#[test]
	fn returns_the_deepest_candidate_for_identical_pages() {
		let pages = vec![
			"<body><main><section><article>same</article></section></main></body>"
				.to_owned();
			10
		];
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&pages, &[])), 10);
	}

	#[test]
	fn returns_the_deepest_candidate_for_no_pages() {
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&[], &[])), 10);
	}

	#[test]
	fn counts_a_jump_of_exactly_the_knee_ratio_as_a_knee() {
		// Two clusters at the first depth ({A, B}, {C}), three at the next
		// (A and B now differ): 3 / 2 = 1.5, exactly the minimum ratio.
		let first = vec![vec![1, 2], vec![1, 2], vec![7]];
		let deeper = vec![vec![1, 2, 3], vec![1, 2, 4], vec![7]];
		let mut sets = vec![first];
		sets.extend(vec![deeper; 6]);
		assert_eq!(detect_content_depth_cap(&sets), 2);
	}

	#[test]
	fn ignores_page_unique_noise_classes_when_counting_clusters() {
		// Pages 0 and 1 differ only in an emotion-style noise class on the
		// <p>, which survives the cap from depth 2 on; page 2 is unrelated.
		// The noise class is not a token, so the count never moves: no knee.
		let pages: Vec<String> = vec![
			"<body><main><section><p class=\"css-1x2y3z\">a</p></section></main></body>".to_owned(),
			"<body><main><section><p class=\"css-9z8y7x\">a</p></section></main></body>".to_owned(),
			"<body><main><em>different</em></main></body>".to_owned(),
		];
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&pages, &[])), 10);
	}

	#[test]
	fn never_picks_depth_one_because_the_sweep_starts_at_two() {
		// Page-unique content already sits at depth 2, so there is no jump
		// to find from depth 2 on: the block stays uncapped.
		let pages: Vec<String> = TAGS
			.iter()
			.map(|tag| format!("<body><main><article><{tag}>x</{tag}></article></main></body>"))
			.collect();
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&pages, &[])), 10);
	}

	fn page_root_pages() -> Vec<String> {
		TAGS.iter()
			.map(|tag| {
				format!(
					"<body><div id=\"page\"><section><article><div><{tag}>x</{tag}></div></article></section></div></body>"
				)
			})
			.collect()
	}

	#[test]
	fn anchors_the_sweep_on_pages_without_main_using_the_content_root_hint() {
		let pages = page_root_pages();
		let hints: Vec<Option<ContentRoot>> = pages.iter().map(|_| Some(page_hint())).collect();
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&pages, &hints)), 3);
		// No hint and no built-in anchor: nothing is capped at any depth, so
		// there is no knee.
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&pages, &[])), 10);
	}

	#[test]
	fn applies_the_content_root_hint_per_page() {
		// Even pages are anchored by the hint, odd pages fall back to <main>.
		let pages: Vec<String> = TAGS
			.iter()
			.enumerate()
			.map(|(index, tag)| {
				if index % 2 == 0 {
					format!(
						"<body><div id=\"page\"><section><article><div><{tag}>x</{tag}></div></article></section></div></body>"
					)
				} else {
					format!(
						"<body><main><section><article><div><{tag}>x</{tag}></div></article></section></main></body>"
					)
				}
			})
			.collect();
		let hints: Vec<Option<ContentRoot>> = (0..pages.len())
			.map(|index| {
				if index % 2 == 0 {
					Some(page_hint())
				} else {
					None
				}
			})
			.collect();
		assert_eq!(detect_content_depth_cap(&sets_by_depth(&pages, &hints)), 3);
	}
}
