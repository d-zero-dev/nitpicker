//! Stage A: splitting one block of pages into structural clusters.

use indexmap::IndexMap;
use rayon::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::assign_contained_clusters::{
	ContainedClusterEntry, assign_contained_clusters, collapse_anonymous_divs,
};
use crate::auto_cut_threshold::auto_cut_threshold;
use crate::complete_linkage_dendrogram::{complete_linkage_dendrogram, labels_at_threshold};
use crate::derive_comparison_sets::{MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT, derive_comparison_sets};
use crate::detect_content_depth_cap::{CANDIDATE_DEPTHS, detect_content_depth_cap};
use crate::jaccard::sorted_set;
use crate::page::PreparedPage;
use crate::vocabulary::{Ids, Vocabulary};

/// The default merge height the per-block cut may only loosen.
const SIMILARITY_THRESHOLD: f64 = 0.8;

/// A class must occur on this many of a block's pages to be template
/// structure; one on a single page is a page label (`<article
/// class="outline">`) that would otherwise prefix — and differentiate —
/// every path beneath it. An absolute floor: "on more than one page" does
/// not scale with the pool.
const MIN_PAGES_PER_RECURRING_CLASS: usize = 2;

/// One page of a block.
pub struct BlockMember<'a> {
	/// What was read from the page. [`stage_a`] releases its tokens and
	/// markup once the block's comparison sets are built (see
	/// [`PreparedPage::release_tokens`]); its landmark instances stay.
	pub page: &'a mut PreparedPage,
	/// The tokens of its local-chrome landmark instances.
	pub local_tokens: &'a [u32],
}

/// One cluster of a block, by member position.
#[derive(Debug)]
pub struct BlockCluster {
	/// `JSON.stringify([blockKey, "cluster:N"])`.
	pub key: String,
	/// Member positions, ascending.
	pub positions: Vec<usize>,
}

/// Stage A's result for one block.
#[derive(Debug)]
pub struct StageAResult {
	/// The content depth applied (`None` for a single page, never swept).
	pub max_depth: Option<usize>,
	/// The classes the pages were tokenized with (`None` below the floor,
	/// where nothing was stripped).
	pub allowed_classes: Option<FxHashSet<u32>>,
	/// Clusters in first-seen order.
	pub clusters: Vec<BlockCluster>,
	/// Each member's cluster index.
	pub cluster_of_member: Vec<usize>,
	/// Each member's compared token set, in insertion order: its tokens,
	/// then its local-chrome tokens.
	pub token_sets: Vec<Vec<u32>>,
}

fn recurring_classes(class_lists: &[&[u32]]) -> FxHashSet<u32> {
	let mut pages_by_class: FxHashMap<u32, usize> = FxHashMap::default();
	for classes in class_lists {
		for &class in classes.iter().collect::<FxHashSet<_>>() {
			*pages_by_class.entry(class).or_insert(0) += 1;
		}
	}
	pages_by_class
		.into_iter()
		.filter(|&(_, pages)| pages >= MIN_PAGES_PER_RECURRING_CLASS)
		.map(|(class, _)| class)
		.collect()
}

/// `JSON.stringify([block_key, label])`.
fn unit_key(block_key: &str, label: &str) -> String {
	format!(
		"[{},{}]",
		crate::js_string::json_string(block_key),
		crate::js_string::json_string(label)
	)
}

/// Each cluster's root after folding clusters into the ones containing
/// them; `comparison_sets` are the members' compared sets.
fn fold_contained(
	roots: &[usize],
	comparison_sets: &[Vec<u32>],
	vocabulary: &Vocabulary,
) -> Vec<usize> {
	let mut collapsed_ids: FxHashMap<u32, u32> = FxHashMap::default();
	let mut collapsed_names: FxHashMap<String, u32> = FxHashMap::default();
	let mut collapse = |token: u32| -> u32 {
		*collapsed_ids.entry(token).or_insert_with(|| {
			let collapsed = collapse_anonymous_divs(&vocabulary.token(token));
			let next = u32::try_from(collapsed_names.len()).expect("fewer than 2^32 tokens");
			*collapsed_names.entry(collapsed).or_insert(next)
		})
	};
	let mut entries: IndexMap<usize, ContainedClusterEntry> = IndexMap::new();
	for (member, &root) in roots.iter().enumerate() {
		let entry = entries
			.entry(root)
			.or_insert_with(|| ContainedClusterEntry {
				id: root,
				tokens: FxHashSet::default(),
				page_count: 0,
			});
		for &token in &comparison_sets[member] {
			entry.tokens.insert(collapse(token));
		}
		entry.page_count += 1;
	}
	let entries: Vec<ContainedClusterEntry> = entries.into_values().collect();
	let folded = assign_contained_clusters(&entries);
	roots
		.iter()
		.map(|root| folded.get(root).copied().unwrap_or(*root))
		.collect()
}

/// Clusters one block's pages.
///
/// The block's content depth is swept first (single pages excepted: they
/// can only form one cluster). From the floor of
/// [`MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT`] pages up, classes found on a single
/// page are stripped — at tokenization, so a wrapper left class-less folds
/// exactly as if the class were never written — and the pages tokenized
/// again; below it "on one page" is no evidence, and other blocks still
/// need the class-bearing tokens to match against. Then: chrome-narrowed
/// comparison sets, the complete-linkage dendrogram, its max-gap cut
/// (at most [`SIMILARITY_THRESHOLD`]) and, from the same floor, folding
/// clusters into ones containing them.
pub fn stage_a(
	block_key: &str,
	members: &mut [BlockMember],
	vocabulary: &Vocabulary,
) -> StageAResult {
	let size = members.len();

	let depth_index = (size > 1).then(|| {
		let sets_by_depth: Vec<Vec<Vec<u32>>> = (0..CANDIDATE_DEPTHS.len())
			.map(|index| {
				members
					.par_iter()
					.map(|member| sorted_set(&member.page.depth_tokens.at(Some(index)).tokens))
					.collect()
			})
			.collect();
		let depth = detect_content_depth_cap(&sets_by_depth);
		CANDIDATE_DEPTHS
			.iter()
			.position(|&candidate| candidate == depth)
			.expect("the detected depth is a candidate")
	});

	let allowed_classes = (size >= MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT).then(|| {
		let class_lists: Vec<&[u32]> = members
			.iter()
			.map(|member| member.page.depth_tokens.at(depth_index).classes.as_slice())
			.collect();
		recurring_classes(&class_lists)
	});

	let tokens: Vec<Vec<u32>> = match &allowed_classes {
		Some(allowed) => members
			.par_iter()
			.map(|member| {
				member
					.page
					.tokens_with_allowed_classes(depth_index, allowed, &mut Ids::Shared(vocabulary))
					.tokens
			})
			.collect(),
		None => members
			.iter()
			.map(|member| member.page.depth_tokens.at(depth_index).tokens.clone())
			.collect(),
	};

	let token_sets: Vec<Vec<u32>> = tokens
		.into_iter()
		.zip(members.iter())
		.map(|(mut tokens, member)| {
			let mut seen: FxHashSet<u32> = tokens.iter().copied().collect();
			for &token in member.local_tokens {
				if seen.insert(token) {
					tokens.push(token);
				}
			}
			tokens
		})
		.collect();

	// The pages' tokens and markup are not read again; only the comparison
	// sets are, and they are what the quadratic work below holds beside.
	for member in members.iter_mut() {
		member.page.release_tokens();
	}

	let sorted: Vec<Vec<u32>> = token_sets.iter().map(|set| sorted_set(set)).collect();
	let comparison_sets = derive_comparison_sets(&sorted);
	let merges = complete_linkage_dendrogram(&comparison_sets);
	let heights: Vec<f64> = merges.iter().map(|merge| merge.height).collect();
	let cut = auto_cut_threshold(&heights, SIMILARITY_THRESHOLD);
	let mut roots = labels_at_threshold(size, &merges, cut);
	if size >= MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT {
		roots = fold_contained(&roots, &comparison_sets, vocabulary);
	}

	let mut label_of_root: IndexMap<usize, usize> = IndexMap::new();
	let mut clusters: Vec<BlockCluster> = Vec::new();
	let cluster_of_member: Vec<usize> = roots
		.iter()
		.enumerate()
		.map(|(position, root)| {
			let next = label_of_root.len();
			let label = *label_of_root.entry(*root).or_insert(next);
			if label == clusters.len() {
				clusters.push(BlockCluster {
					key: unit_key(block_key, &format!("cluster:{label}")),
					positions: Vec::new(),
				});
			}
			clusters[label].positions.push(position);
			label
		})
		.collect();

	StageAResult {
		max_depth: depth_index.map(|index| CANDIDATE_DEPTHS[index]),
		allowed_classes,
		clusters,
		cluster_of_member,
		token_sets,
	}
}

#[cfg(test)]
mod tests {
	use std::collections::BTreeSet;

	use super::{BlockMember, StageAResult, stage_a, unit_key};
	use crate::complete_linkage_dendrogram::{complete_linkage_dendrogram, labels_at_threshold};
	use crate::content_root::ContentRoot;
	use crate::derive_comparison_sets::{
		MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT, derive_comparison_sets,
	};
	use crate::jaccard::{jaccard, sorted_set};
	use crate::page::{DepthTokens, Preparation, prepare_page};
	use crate::vocabulary::{Ids, Vocabulary};

	/// Stage A on one block (`path:section`) of `html_list`, with no local
	/// chrome, prepared the way the block's size calls for.
	fn run_block(
		html_list: &[String],
		hints: &[Option<ContentRoot>],
	) -> (StageAResult, Vocabulary) {
		let vocabulary = Vocabulary::default();
		let size = html_list.len();
		let preparation = Preparation {
			sweep: size > 1,
			retain_markup: size >= MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT,
		};
		let mut pages: Vec<_> = {
			let mut ids = Ids::Shared(&vocabulary);
			html_list
				.iter()
				.enumerate()
				.map(|(index, html)| {
					let hint = hints.get(index).and_then(Option::as_ref);
					prepare_page(html, hint, preparation, &mut ids)
				})
				.collect()
		};
		let mut members: Vec<BlockMember> = pages
			.iter_mut()
			.map(|page| BlockMember {
				page,
				local_tokens: &[],
			})
			.collect();
		let result = stage_a("path:section", &mut members, &vocabulary);
		(result, vocabulary)
	}

	fn allowed_class_names(result: &StageAResult, vocabulary: &Vocabulary) -> BTreeSet<String> {
		result
			.allowed_classes
			.as_ref()
			.expect("classes were restricted")
			.iter()
			.map(|&class| vocabulary.classes.resolve(class).to_string())
			.collect()
	}

	fn names(classes: &[&str]) -> BTreeSet<String> {
		classes.iter().map(|class| (*class).to_owned()).collect()
	}

	/// A static page whose content root carries a per-page identity class
	/// over a fixed skeleton: `wrap` and `block` recur, `label` does not.
	fn labeled_page(label: &str) -> String {
		format!(
			"<body><div class=\"wrap\"><article class=\"{label}\"><h2>t</h2><section class=\"block\"><p>x</p></section></article></div></body>"
		)
	}

	/// The cluster each page of `sets` lands in when the dendrogram is cut
	/// at the fixed `threshold`, after the chrome-narrowing every block
	/// applies.
	fn cluster_labels(sets: &[Vec<u32>], threshold: f64) -> Vec<usize> {
		let comparison = derive_comparison_sets(sets);
		let merges = complete_linkage_dendrogram(&comparison);
		labels_at_threshold(comparison.len(), &merges, threshold)
	}

	/// `count` ids from `base` up.
	fn run_of(base: u32, count: u32) -> Vec<u32> {
		(base..base + count).collect()
	}

	fn with(mut set: Vec<u32>, extra: &[u32]) -> Vec<u32> {
		set.extend_from_slice(extra);
		sorted_set(&set)
	}

	#[test]
	fn quotes_unit_keys_like_json_stringify() {
		assert_eq!(
			unit_key("path:\"a\"", "cluster:0"),
			"[\"path:\\\"a\\\"\",\"cluster:0\"]"
		);
	}

	#[test]
	fn separates_two_templates_in_one_block() {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		let list = "<body><main><ul><li><a></a></li><li><a></a></li></ul><nav class=\"pager\"><a></a></nav></main></body>";
		let detail =
			"<body><main><article><h1></h1><p></p><figure><img></figure></article></main></body>";
		let preparation = Preparation {
			sweep: true,
			retain_markup: false,
		};
		let mut pages: Vec<_> = [list, list, detail, detail]
			.iter()
			.map(|html| prepare_page(html, None, preparation, &mut ids))
			.collect();
		let mut members: Vec<BlockMember> = pages
			.iter_mut()
			.map(|page| BlockMember {
				page,
				local_tokens: &[],
			})
			.collect();
		let result = stage_a("path:news", &mut members, &vocabulary);
		assert_eq!(result.cluster_of_member, vec![0, 0, 1, 1]);
		assert_eq!(result.clusters[1].key, "[\"path:news\",\"cluster:1\"]");
		assert_eq!(result.max_depth, Some(10));
		assert!(result.allowed_classes.is_none());
	}

	#[test]
	fn releases_the_tokens_of_its_pages_but_not_their_landmarks() {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		let preparation = Preparation {
			sweep: true,
			retain_markup: false,
		};
		let html = "<body><nav><a>n</a></nav><main><p>a</p></main></body>";
		let mut pages: Vec<_> = (0..2)
			.map(|_| prepare_page(html, None, preparation, &mut ids))
			.collect();
		let mut members: Vec<BlockMember> = pages
			.iter_mut()
			.map(|page| BlockMember {
				page,
				local_tokens: &[],
			})
			.collect();
		stage_a("path:news", &mut members, &vocabulary);
		for page in &pages {
			assert!(matches!(page.depth_tokens, DepthTokens::Released));
			assert_eq!(page.instances.len(), 1);
		}
	}

	#[test]
	fn excludes_classes_on_a_single_page_at_ten_pages() {
		let pages: Vec<String> = (0..10)
			.map(|i| labeled_page(&format!("page-{i}")))
			.collect();
		let (result, vocabulary) = run_block(&pages, &[]);
		assert_eq!(
			allowed_class_names(&result, &vocabulary),
			names(&["wrap", "block"])
		);
		assert_eq!(result.clusters.len(), 1);
	}

	#[test]
	fn keeps_every_class_and_every_page_apart_below_ten_pages() {
		let pages: Vec<String> = (0..9).map(|i| labeled_page(&format!("page-{i}"))).collect();
		let (result, _) = run_block(&pages, &[]);
		assert!(result.allowed_classes.is_none());
		assert_eq!(result.clusters.len(), 9);
	}

	#[test]
	fn reports_the_full_recurring_set_when_every_class_recurs() {
		let pages = vec![labeled_page("same"); 10];
		let (result, vocabulary) = run_block(&pages, &[]);
		assert_eq!(
			allowed_class_names(&result, &vocabulary),
			names(&["wrap", "same", "block"])
		);
		assert_eq!(result.clusters.len(), 1);
	}

	#[test]
	fn keeps_a_class_shared_by_exactly_two_pages_and_separates_them_from_the_rest() {
		// The variant is a plain <div>, not a landmark: landmarks are cut
		// out before Stage A and only return as local chrome, which this
		// direct call leaves empty.
		let mut pages: Vec<String> = (0..8).map(|i| labeled_page(&format!("page-{i}"))).collect();
		pages.extend((0..2).map(|i| {
			labeled_page(&format!("note-{i}")).replace(
				"</article>",
				"</article><div class=\"with-note\"><ul><li><a>x</a></li><li><a>y</a></li></ul><p>note</p></div>",
			)
		}));
		let (result, vocabulary) = run_block(&pages, &[]);
		assert_eq!(
			allowed_class_names(&result, &vocabulary),
			names(&["wrap", "block", "with-note"])
		);
		let keys = &result.cluster_of_member;
		assert!(keys[..8].iter().all(|&key| key == keys[0]));
		assert_eq!(keys[8], keys[9]);
		assert_ne!(keys[8], keys[0]);
	}

	#[test]
	fn leaves_a_single_page_block_untouched() {
		let (result, _) = run_block(&[labeled_page("only")], &[]);
		assert!(result.allowed_classes.is_none());
		assert_eq!(result.max_depth, None);
		assert_eq!(result.clusters.len(), 1);
		assert_eq!(result.clusters[0].key, "[\"path:section\",\"cluster:0\"]");
	}

	fn page_root_pages() -> Vec<String> {
		// Twelve pages under <div id="page"> (not a built-in fallback),
		// identical down to depth 3 and differing only in the tag at depth
		// 4: they cluster together exactly when the cap at depth 3 applies.
		[
			"em", "strong", "b", "i", "u", "code", "kbd", "samp", "var", "mark", "q", "s",
		]
		.iter()
		.map(|tag| {
			format!(
				"<body><div id=\"page\"><section><article><div><{tag}>x</{tag}></div></article></section></div></body>"
			)
		})
		.collect()
	}

	fn page_hint() -> ContentRoot {
		ContentRoot {
			id: Some("page".to_owned()),
			..ContentRoot::default()
		}
	}

	#[test]
	fn collapses_a_block_to_one_cluster_at_the_depth_its_content_roots_anchor() {
		let pages = page_root_pages();
		let hints: Vec<Option<ContentRoot>> = pages.iter().map(|_| Some(page_hint())).collect();
		let (result, _) = run_block(&pages, &hints);
		assert_eq!(result.max_depth, Some(3));
		assert_eq!(result.clusters.len(), 1);
	}

	#[test]
	fn caps_nothing_without_a_content_root_and_keeps_distinct_pages_apart() {
		let (result, _) = run_block(&page_root_pages(), &[]);
		assert_eq!(result.max_depth, Some(10));
		assert_eq!(result.clusters.len(), 12);
	}

	#[test]
	fn reports_no_depth_for_a_single_page_block() {
		let pages = page_root_pages();
		let (result, _) = run_block(&pages[..1], &[Some(page_hint())]);
		assert_eq!(result.max_depth, None);
	}

	#[test]
	fn keys_every_cluster_with_its_block() {
		let pages = page_root_pages();
		let hints: Vec<Option<ContentRoot>> = pages.iter().map(|_| Some(page_hint())).collect();
		let (result, _) = run_block(&pages, &hints);
		let keys: Vec<&str> = result
			.clusters
			.iter()
			.map(|cluster| cluster.key.as_str())
			.collect();
		assert_eq!(keys, vec!["[\"path:section\",\"cluster:0\"]"]);
	}

	#[test]
	fn clusters_no_pages_into_no_labels() {
		assert_eq!(cluster_labels(&[], 0.8), Vec::<usize>::new());
	}

	#[test]
	fn clusters_a_single_set_alone() {
		assert_eq!(cluster_labels(&[vec![1]], 0.8), vec![0]);
	}

	#[test]
	fn merges_identical_sets() {
		let labels = cluster_labels(&[vec![1, 2, 3], vec![1, 2, 3]], 0.8);
		assert_eq!(labels[0], labels[1]);
	}

	#[test]
	fn merges_a_pair_at_exactly_the_threshold() {
		// Eight shared ids and one unique each: 8 / 10 = 0.8, inclusive.
		let a = with(run_of(0, 8), &[100]);
		let b = with(run_of(0, 8), &[101]);
		let labels = cluster_labels(&[a, b], 0.8);
		assert_eq!(labels[0], labels[1]);
	}

	#[test]
	fn keeps_a_pair_just_below_the_threshold_apart() {
		// Seven shared ids and two unique each: 7 / 11 is about 0.636.
		let a = with(run_of(0, 7), &[100, 101]);
		let b = with(run_of(0, 7), &[102, 103]);
		let labels = cluster_labels(&[a, b], 0.8);
		assert_ne!(labels[0], labels[1]);
	}

	#[test]
	fn merges_a_pair_at_a_threshold_assembled_from_arithmetic() {
		// 0.1 + 0.2 is 0.30000000000000004, not 0.3: a pair at exactly
		// 3 / 10 must still count as meeting it.
		let a = vec![1, 2, 3, 11, 12, 13, 14];
		let b = vec![1, 2, 3, 21, 22, 23];
		let labels = cluster_labels(&[a, b], 0.1 + 0.2);
		assert_eq!(labels[0], labels[1]);
	}

	#[test]
	fn merges_every_page_at_threshold_zero() {
		let labels = cluster_labels(&[vec![1], vec![2], vec![3]], 0.0);
		assert_eq!(labels[0], labels[1]);
		assert_eq!(labels[1], labels[2]);
	}

	#[test]
	fn merges_only_identical_sets_at_threshold_one() {
		let labels = cluster_labels(&[vec![1, 2], vec![1, 2], vec![1, 2, 3]], 1.0);
		assert_eq!(labels[0], labels[1]);
		assert_ne!(labels[2], labels[0]);
	}

	#[test]
	fn refuses_to_chain_through_a_shared_bridge() {
		// A-B is 2/3, B-C is 2/4, A-C is 1/4: at 0.5 both A-B and B-C
		// clear it but A-C does not, so complete linkage keeps C out.
		let labels = cluster_labels(&[vec![1, 2], vec![1, 2, 3], vec![1, 3, 4]], 0.5);
		assert_eq!(labels[0], labels[1]);
		assert_ne!(labels[2], labels[0]);
	}

	#[test]
	fn labels_two_templates_into_two_clusters() {
		let labels = cluster_labels(&[vec![1, 2, 3], vec![1, 2, 3], vec![4, 5]], 0.8);
		assert_eq!(labels[0], labels[1]);
		assert_ne!(labels[2], labels[0]);
		assert_eq!(labels.iter().collect::<BTreeSet<_>>().len(), 2);
	}

	#[test]
	fn keeps_three_mutually_dissimilar_sets_in_three_clusters() {
		let labels = cluster_labels(&[vec![1], vec![2, 3], vec![4, 5, 6]], 0.8);
		assert_eq!(labels.iter().collect::<BTreeSet<_>>().len(), 3);
	}

	/// Mulberry32, so the differential inputs are reproducible.
	struct Mulberry32(u32);

	impl Mulberry32 {
		fn next_f64(&mut self) -> f64 {
			self.0 = self.0.wrapping_add(1_831_565_813);
			let mut t = self.0;
			t = (t ^ (t >> 15)).wrapping_mul(t | 1);
			t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 0x3D));
			f64::from(t ^ (t >> 14)) / 4_294_967_296.0
		}
	}

	/// `count` random sets over `vocabulary_size` ids (each id on a page
	/// with probability 1/2), each plus `chrome` ids every page carries.
	fn random_sets(seed: u32, count: usize, vocabulary_size: u32, chrome: u32) -> Vec<Vec<u32>> {
		let mut random = Mulberry32(seed);
		(0..count)
			.map(|_| {
				let mut set = run_of(1000, chrome);
				set.extend((0..vocabulary_size).filter(|_| random.next_f64() < 0.5));
				sorted_set(&set)
			})
			.collect()
	}

	/// Repeatedly merges the best (highest minimum pairwise similarity)
	/// pair of live clusters, rescanning every pair: obviously correct, and
	/// cubic.
	fn brute_force_complete_linkage(sets: &[Vec<u32>], threshold: f64) -> Vec<usize> {
		let mut clusters: Vec<Vec<usize>> = (0..sets.len()).map(|index| vec![index]).collect();
		loop {
			let mut best: Option<(usize, usize)> = None;
			let mut best_score = f64::NEG_INFINITY;
			for i in 0..clusters.len() {
				for j in i + 1..clusters.len() {
					let mut minimum = f64::INFINITY;
					for &p in &clusters[i] {
						for &q in &clusters[j] {
							minimum = minimum.min(jaccard(&sets[p], &sets[q]));
						}
					}
					if minimum > best_score {
						best_score = minimum;
						best = Some((i, j));
					}
				}
			}
			let Some((i, j)) = best else { break };
			if best_score < threshold {
				break;
			}
			let absorbed = clusters.remove(j);
			clusters[i].extend(absorbed);
		}
		let mut labels = vec![0; sets.len()];
		for (label, members) in clusters.iter().enumerate() {
			for &member in members {
				labels[member] = label;
			}
		}
		labels
	}

	/// Whether every pair of positions is together in one labeling exactly
	/// when it is in the other.
	fn same_partition(a: &[usize], b: &[usize]) -> bool {
		a.len() == b.len()
			&& (0..a.len()).all(|i| (i + 1..a.len()).all(|j| (a[i] == a[j]) == (b[i] == b[j])))
	}

	#[test]
	fn matches_a_brute_force_complete_linkage_on_random_inputs() {
		for seed in 1..=10 {
			for vocabulary_size in [4, 6, 10] {
				for threshold in [0.3, 0.5, 0.8] {
					let sets = random_sets(seed, 8, vocabulary_size, 0);
					let actual = cluster_labels(&sets, threshold);
					let expected = brute_force_complete_linkage(&sets, threshold);
					assert!(
						same_partition(&actual, &expected),
						"seed {seed}, vocabulary {vocabulary_size}, threshold {threshold}: {actual:?} against {expected:?}"
					);
				}
			}
		}
	}

	#[test]
	fn matches_a_brute_force_on_the_chrome_narrowed_sets_from_ten_pages_up() {
		// Twelve pages clear the floor, so the sets are narrowed before
		// clustering; four ids on every page make sure something is cut.
		for seed in 1..=5 {
			for vocabulary_size in [6, 10] {
				for threshold in [0.3, 0.5, 0.8] {
					let sets = random_sets(seed, 12, vocabulary_size, 4);
					let actual = cluster_labels(&sets, threshold);
					let expected =
						brute_force_complete_linkage(&derive_comparison_sets(&sets), threshold);
					assert!(
						same_partition(&actual, &expected),
						"seed {seed}, vocabulary {vocabulary_size}, threshold {threshold}: {actual:?} against {expected:?}"
					);
				}
			}
		}
	}

	#[test]
	fn does_not_let_chrome_on_every_page_inflate_the_similarity_of_two_pages() {
		// Eight ids on all ten pages; A and B add one of their own. Raw
		// similarity is 8/10, which would merge them; narrowed to what is
		// page-specific they share nothing.
		let chrome = run_of(0, 8);
		let a = with(chrome.clone(), &[100]);
		let b = with(chrome.clone(), &[101]);
		assert!((jaccard(&a, &b) - 0.8).abs() < 1e-9);
		let mut sets = vec![a, b];
		sets.extend((0..8).map(|i| with(chrome.clone(), &[200 + i])));
		let labels = cluster_labels(&sets, 0.8);
		assert_ne!(labels[0], labels[1]);
	}

	#[test]
	fn still_merges_two_genuinely_empty_pages() {
		let chrome = run_of(0, 8);
		let mut sets = vec![Vec::new(), Vec::new()];
		sets.extend((0..8).map(|i| with(chrome.clone(), &[200 + i])));
		let labels = cluster_labels(&sets, 0.8);
		assert_eq!(labels[0], labels[1]);
	}

	#[test]
	fn does_not_force_merge_two_pages_whose_narrowed_sets_are_both_empty() {
		// A and B consist entirely of chrome (each id is on 9 of 10 pages),
		// so both narrow to nothing and would compare as identical empty
		// sets; their raw sets share nothing.
		let a = vec![0, 1];
		let b = vec![2, 3];
		assert!(jaccard(&a, &b).abs() < f64::EPSILON);
		let mut sets = vec![a, b];
		sets.extend((0..8).map(|i| vec![0, 1, 2, 3, 200 + i]));
		let labels = cluster_labels(&sets, 0.8);
		assert_ne!(labels[0], labels[1]);
	}

	#[test]
	fn merges_a_chrome_sharing_pair_below_the_ten_page_floor() {
		let chrome = run_of(0, 8);
		let mut sets = vec![with(chrome.clone(), &[100]), with(chrome.clone(), &[101])];
		sets.extend((0..7).map(|i| with(chrome.clone(), &[200 + i])));
		let labels = cluster_labels(&sets, 0.8);
		assert_eq!(labels[0], labels[1]);
	}

	#[test]
	fn merges_a_near_duplicate_pair_of_two_pages() {
		// 18 / 20 similar: narrowing to page-specific ids at n = 2 would
		// make any two different sets disjoint.
		let a = with(run_of(0, 18), &[100]);
		let b = with(run_of(0, 18), &[101]);
		let labels = cluster_labels(&[a, b], 0.8);
		assert_eq!(labels[0], labels[1]);
	}
}
