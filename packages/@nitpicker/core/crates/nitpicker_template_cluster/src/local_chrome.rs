use rustc_hash::{FxHashMap, FxHashSet};

use crate::auto_cut_threshold::auto_cut_threshold;
use crate::page::LandmarkInstance;

/// Which landmark instances are local chrome across a pool of pages, and
/// each page's tokens from them.
#[derive(Debug, Default)]
pub struct LocalChrome {
	/// Signatures of the instances that are local chrome.
	pub signatures: FxHashSet<Vec<u32>>,
	/// Per page, the tokens of its local-chrome instances (in instance order).
	pub tokens_by_page: Vec<Vec<u32>>,
}

/// Splits landmark instances into global chrome (on effectively every page:
/// no signal, left cut out) and local chrome (shared by some pages only —
/// a section's own nav), whose tokens go back into those pages' sets.
///
/// The split is the max-gap cut (capped at 0.8) over how many pages carry
/// each instance signature. An instance on a single page is neither: it is
/// per-page variation, and putting it back would split that page off. The
/// tokens go back in full rather than as one marker token, because one
/// token among a hundred moves Jaccard by about 0.01 — not enough to
/// separate pages with and without a section's nav.
#[must_use]
pub fn compute_local_chrome(pages: &[&[LandmarkInstance]]) -> LocalChrome {
	let page_count = pages.len();
	let empty = || LocalChrome {
		signatures: FxHashSet::default(),
		tokens_by_page: vec![Vec::new(); page_count],
	};
	if page_count == 0 {
		return LocalChrome::default();
	}
	let mut counts: FxHashMap<&[u32], usize> = FxHashMap::default();
	for instances in pages {
		for instance in *instances {
			*counts.entry(&instance.signature).or_insert(0) += 1;
		}
	}
	if counts.is_empty() {
		return empty();
	}
	// Page counts stay far below 2^52; the conversions are exact.
	#[allow(clippy::cast_precision_loss)]
	let frequency = |count: usize| count as f64 / page_count as f64;
	let frequencies: Vec<f64> = counts.values().map(|&count| frequency(count)).collect();
	let cut = auto_cut_threshold(&frequencies, 0.8);
	let signatures: FxHashSet<Vec<u32>> = counts
		.iter()
		.filter(|&(_, &count)| count >= 2 && frequency(count) < cut)
		.map(|(signature, _)| signature.to_vec())
		.collect();
	if signatures.is_empty() {
		return empty();
	}
	let tokens_by_page = pages
		.iter()
		.map(|instances| {
			let mut seen = FxHashSet::default();
			let mut tokens = Vec::new();
			for instance in instances
				.iter()
				.filter(|instance| signatures.contains(&instance.signature))
			{
				for &token in &instance.tokens {
					if seen.insert(token) {
						tokens.push(token);
					}
				}
			}
			tokens
		})
		.collect();
	LocalChrome {
		signatures,
		tokens_by_page,
	}
}

#[cfg(test)]
mod tests {
	use super::compute_local_chrome;
	use crate::extract_landmarks::LandmarkType;
	use crate::page::{LandmarkInstance, Preparation, PreparedPage, prepare_page};
	use crate::stage_a::{BlockMember, StageAResult, stage_a};
	use crate::vocabulary::{Ids, Vocabulary};

	fn prepare(vocabulary: &Vocabulary, html: &str) -> PreparedPage {
		let preparation = Preparation {
			sweep: true,
			retain_markup: false,
		};
		prepare_page(html, None, preparation, &mut Ids::Shared(vocabulary))
	}

	/// Stage A on one block, with the local chrome the block's own
	/// landmarks give.
	fn run_with_local_chrome(html_list: &[String]) -> StageAResult {
		let vocabulary = Vocabulary::default();
		let preparation = Preparation {
			sweep: true,
			retain_markup: html_list.len() >= 10,
		};
		let pages: Vec<PreparedPage> = html_list
			.iter()
			.map(|html| prepare_page(html, None, preparation, &mut Ids::Shared(&vocabulary)))
			.collect();
		let instances: Vec<&[LandmarkInstance]> =
			pages.iter().map(|page| page.instances.as_slice()).collect();
		let chrome = compute_local_chrome(&instances);
		let members: Vec<BlockMember> = pages
			.iter()
			.zip(&chrome.tokens_by_page)
			.map(|(page, tokens)| BlockMember {
				page,
				local_tokens: tokens,
			})
			.collect();
		stage_a("path:articles", &members, &vocabulary)
	}

	fn instance(tokens: &[u32]) -> LandmarkInstance {
		let mut signature = tokens.to_vec();
		signature.sort_unstable();
		LandmarkInstance {
			kind: LandmarkType::Nav,
			tokens: tokens.to_vec(),
			signature,
		}
	}

	#[test]
	fn reinjects_instances_shared_by_some_pages_only() {
		let global = instance(&[1, 2]);
		let local = instance(&[10, 11]);
		let unique = instance(&[20]);
		let pages: Vec<Vec<LandmarkInstance>> = vec![
			vec![global.clone(), local.clone()],
			vec![global.clone(), local.clone()],
			vec![global.clone(), unique],
			vec![global.clone()],
			vec![global],
		];
		let refs: Vec<&[LandmarkInstance]> = pages.iter().map(Vec::as_slice).collect();
		let chrome = compute_local_chrome(&refs);
		assert_eq!(chrome.signatures.len(), 1);
		assert_eq!(
			chrome.tokens_by_page,
			vec![vec![10, 11], vec![10, 11], vec![], vec![], vec![]]
		);
	}

	#[test]
	fn finds_no_instances_on_a_page_without_landmarks() {
		let vocabulary = Vocabulary::default();
		let page = prepare(&vocabulary, "<body><main><p>x</p></main></body>");
		assert!(page.instances.is_empty());
	}

	#[test]
	fn reads_every_landmark_instance_with_its_tokens_and_signature() {
		let vocabulary = Vocabulary::default();
		let page = prepare(
			&vocabulary,
			"<body><header><nav>a</nav></header><footer><a>x</a></footer></body>",
		);
		let kinds: Vec<LandmarkType> = page.instances.iter().map(|i| i.kind).collect();
		assert_eq!(kinds, vec![LandmarkType::Header, LandmarkType::Footer]);
		for instance in &page.instances {
			assert!(!instance.tokens.is_empty());
			let mut sorted = instance.tokens.clone();
			sorted.sort_unstable();
			sorted.dedup();
			assert_eq!(instance.signature, sorted);
		}
	}

	#[test]
	fn folds_byte_identical_instances_on_one_page_into_one() {
		let vocabulary = Vocabulary::default();
		let page = prepare(
			&vocabulary,
			"<body><footer><a>x</a></footer><footer><a>x</a></footer></body>",
		);
		assert_eq!(page.instances.len(), 1);
		assert_eq!(page.instances[0].kind, LandmarkType::Footer);
	}

	#[test]
	fn keeps_instances_with_different_token_sets_apart() {
		let vocabulary = Vocabulary::default();
		let page = prepare(
			&vocabulary,
			"<body><nav><a class=\"one\">a</a></nav><nav><a class=\"two\">b</a></nav></body>",
		);
		assert_eq!(page.instances.len(), 2);
		assert_ne!(page.instances[0].signature, page.instances[1].signature);
	}

	#[test]
	fn does_not_fold_the_same_signature_across_pages() {
		let vocabulary = Vocabulary::default();
		let html = "<body><header><nav>a</nav></header></body>";
		let a = prepare(&vocabulary, html);
		let b = prepare(&vocabulary, html);
		assert_eq!(a.instances.len(), 1);
		assert_eq!(b.instances.len(), 1);
		assert_eq!(a.instances[0].signature, b.instances[0].signature);
	}

	#[test]
	fn lists_instances_in_a_fixed_type_order() {
		let vocabulary = Vocabulary::default();
		let page = prepare(
			&vocabulary,
			"<body><search>s</search><div role=\"form\">f</div><aside>a</aside><nav>n</nav><footer>ft</footer><header>h</header></body>",
		);
		let kinds: Vec<LandmarkType> = page.instances.iter().map(|i| i.kind).collect();
		assert_eq!(
			kinds,
			vec![
				LandmarkType::Header,
				LandmarkType::Footer,
				LandmarkType::Nav,
				LandmarkType::Aside,
				LandmarkType::Form,
				LandmarkType::Search,
			]
		);
	}

	fn global_header() -> &'static str {
		"<header><nav>global</nav></header>"
	}

	#[test]
	fn splits_pages_sharing_a_section_local_landmark_from_their_block_siblings() {
		let mut pages: Vec<String> = (0..4)
			.map(|_| {
				format!(
					"<body>{}<main><nav class=\"section-local-nav\"><a>Section</a></nav><article><h1>title</h1><p>body</p></article></main></body>",
					global_header()
				)
			})
			.collect();
		pages.extend((0..6).map(|_| {
			format!(
				"<body>{}<main><article><h1>title</h1><p>body</p></article></main></body>",
				global_header()
			)
		}));
		let result = run_with_local_chrome(&pages);
		let keys = &result.cluster_of_member;
		assert_ne!(keys[0], keys[4]);
		assert!(keys[..4].iter().all(|&key| key == keys[0]));
		assert!(keys[4..].iter().all(|&key| key == keys[4]));
	}

	#[test]
	fn does_not_split_a_page_off_for_a_landmark_on_that_page_only() {
		let mut pages = vec![format!(
			"<body>{}<main><nav class=\"one-off-widget\">unique</nav><article><h1>title</h1><p>body</p></article></main></body>",
			global_header()
		)];
		pages.extend((0..9).map(|_| {
			format!(
				"<body>{}<main><article><h1>title</h1><p>body</p></article></main></body>",
				global_header()
			)
		}));
		let result = run_with_local_chrome(&pages);
		assert_eq!(result.cluster_of_member[0], result.cluster_of_member[1]);
	}

	#[test]
	fn injects_nothing_for_a_signature_on_every_page() {
		let pages: Vec<String> = (0..6)
			.map(|_| {
				format!(
					"<body>{}<main><article><p>body</p></article></main></body>",
					global_header()
				)
			})
			.collect();
		let vocabulary = Vocabulary::default();
		let prepared: Vec<PreparedPage> = pages
			.iter()
			.map(|html| prepare(&vocabulary, html))
			.collect();
		let instances: Vec<&[LandmarkInstance]> = prepared
			.iter()
			.map(|page| page.instances.as_slice())
			.collect();
		let chrome = compute_local_chrome(&instances);
		assert!(chrome.signatures.is_empty());
		assert!(chrome.tokens_by_page.iter().all(Vec::is_empty));
		let result = run_with_local_chrome(&pages);
		assert!(result.cluster_of_member.iter().all(|&key| key == 0));
	}
}
