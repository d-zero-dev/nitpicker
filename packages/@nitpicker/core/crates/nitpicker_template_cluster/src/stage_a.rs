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
	/// What was read from the page.
	pub page: &'a PreparedPage,
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
pub fn stage_a(block_key: &str, members: &[BlockMember], vocabulary: &Vocabulary) -> StageAResult {
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
		.zip(members)
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
	use super::{BlockMember, stage_a, unit_key};
	use crate::page::{Preparation, prepare_page};
	use crate::vocabulary::{Ids, Vocabulary};

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
		let pages: Vec<_> = [list, list, detail, detail]
			.iter()
			.map(|html| prepare_page(html, None, preparation, &mut ids))
			.collect();
		let members: Vec<BlockMember> = pages
			.iter()
			.map(|page| BlockMember {
				page,
				local_tokens: &[],
			})
			.collect();
		let result = stage_a("path:news", &members, &vocabulary);
		assert_eq!(result.cluster_of_member, vec![0, 0, 1, 1]);
		assert_eq!(result.clusters[1].key, "[\"path:news\",\"cluster:1\"]");
		assert_eq!(result.max_depth, Some(10));
		assert!(result.allowed_classes.is_none());
	}
}
