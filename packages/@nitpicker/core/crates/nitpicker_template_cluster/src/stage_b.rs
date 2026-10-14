//! Stage B of the page-template classifier: Stage A's clusters merged
//! across blocks, each page's final key, and each final cluster's reason.
//!
//! The keys and reasons computed here are stored in archives, so every step
//! reproduces the result the stored ones were computed with, down to the
//! order of insertion-ordered maps and the code-unit order of strings. The
//! pieces are in their own modules (`merge_cross_block_clusters` and what it
//! calls, `build_cluster_reason`); this module only frames them: it turns
//! Stage A's `Output` into the merge's input, renames each page's key
//! through the merge's roots and assembles the reasons.

use indexmap::IndexMap;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::build_cluster_reason::{ClusterReason, build_cluster_reason};
use crate::js_string::compare_utf16;
use crate::merge_cross_block_clusters::{MergeInput, merge_cross_block_clusters};
use crate::run::{BLOCK_SAMPLE_SIZE, Output};
use crate::token_view::TokenView;
use crate::vocabulary::Vocabulary;

/// Stage B's result.
#[derive(Debug, PartialEq)]
pub struct StageBResult {
	/// Each page's final cluster key, as an index into [`Output::keys`]: the
	/// key of the root unit its Stage A cluster was merged into (the same key
	/// when it was not).
	pub final_key_of_page: Vec<u32>,
	/// One reason per final cluster, keyed by the cluster's key, in the order
	/// the clusters' first units appear in [`Output::units`].
	pub reasons: Vec<(String, ClusterReason)>,
}

/// Runs Stage B over Stage A's `output`.
///
/// `block_keys` are the run's Pass-0 block keys, indexed by [`crate::Unit::block`];
/// two equal keys are one block. `vocabulary` resolves the token ids of the
/// units. A merged group holding a unit of a sampled block
/// ([`Output::sampled_blocks`]) is capped at [`BLOCK_SAMPLE_SIZE`] members
/// (the cap Stage A sampled the block with), so Stage B's cost stays bounded
/// across rounds whatever the block's size; a group of whole blocks keeps
/// every member.
///
/// Every unit's key is distinct, as Stage A hands them out.
///
/// ## Reasons
///
/// A reason carries the block keys but not their blocking evidence: Pass 0
/// derives that, and the caller attaches it to each key (every block key has
/// evidence). The block of a cluster's unit is the block key
/// stored in the unit's cluster key (`["<blockKey>","cluster:N"]`).
/// Sibling clusters are the final clusters of every unit sharing a block with
/// one of the cluster's units, other than the cluster itself.
#[must_use]
pub fn stage_b(output: &Output, block_keys: &[String], vocabulary: &Vocabulary) -> StageBResult {
	let units = &output.units;
	debug_assert!(
		output.sampled_blocks.is_empty() || output.sampled_blocks.len() == block_keys.len(),
		"one sampling flag per block"
	);
	let sampled_units: Vec<bool> = units
		.iter()
		.map(|unit| {
			output
				.sampled_blocks
				.get(unit.block as usize)
				.copied()
				.unwrap_or(false)
		})
		.collect();

	// Two block numbers with equal keys are one block.
	let mut canonical_of_key: FxHashMap<&str, u32> = FxHashMap::default();
	let canonical: Vec<u32> = block_keys
		.iter()
		.enumerate()
		.map(|(index, key)| {
			*canonical_of_key
				.entry(key.as_str())
				.or_insert_with(|| u32::try_from(index).expect("fewer than 2^32 blocks"))
		})
		.collect();
	let unit_blocks: Vec<u32> = units
		.iter()
		.map(|unit| canonical[unit.block as usize])
		.collect();

	let mut view = TokenView::new(vocabulary);
	let merged = merge_cross_block_clusters(
		&MergeInput {
			units,
			keys: &output.keys,
			blocks: &unit_blocks,
			sampled_units: &sampled_units,
			cap_members: BLOCK_SAMPLE_SIZE,
		},
		&mut view,
	);

	// A key no unit owns stays as it is.
	let mut final_key_of_key: Vec<u32> = (0..output.keys.len())
		.map(|key| u32::try_from(key).expect("fewer than 2^32 keys"))
		.collect();
	for (index, unit) in units.iter().enumerate() {
		final_key_of_key[unit.key as usize] = units[merged.root_of_unit[index]].key;
	}
	let final_key_of_page = output
		.key_of_page
		.iter()
		.map(|&key| final_key_of_key[key as usize])
		.collect();

	let mut units_of_block: FxHashMap<u32, Vec<usize>> = FxHashMap::default();
	let mut units_of_root: IndexMap<usize, Vec<usize>> = IndexMap::new();
	for (index, &block) in unit_blocks.iter().enumerate() {
		units_of_block.entry(block).or_default().push(index);
		units_of_root
			.entry(merged.root_of_unit[index])
			.or_default()
			.push(index);
	}

	let mut reasons = Vec::new();
	for (root, unit_list) in &units_of_root {
		let members = merged.groups[*root]
			.as_ref()
			.expect("a unit's root keeps its group");

		let mut seen_blocks: FxHashSet<u32> = FxHashSet::default();
		let mut reason_block_keys: Vec<String> = Vec::new();
		let mut sibling_roots: FxHashSet<usize> = FxHashSet::default();
		for &unit in unit_list {
			let block = unit_blocks[unit];
			if !seen_blocks.insert(block) {
				continue;
			}
			reason_block_keys.push(block_keys[block as usize].clone());
			for &sibling in &units_of_block[&block] {
				let sibling_root = merged.root_of_unit[sibling];
				if sibling_root != *root {
					sibling_roots.insert(sibling_root);
				}
			}
		}
		let mut sibling_cluster_keys: Vec<String> = sibling_roots
			.into_iter()
			.map(|sibling_root| output.keys[units[sibling_root].key as usize].clone())
			.collect();
		sibling_cluster_keys.sort_by(|a, b| compare_utf16(a, b));

		reasons.push((
			output.keys[units[*root].key as usize].clone(),
			build_cluster_reason(members, reason_block_keys, sibling_cluster_keys, &view),
		));
	}

	StageBResult {
		final_key_of_page,
		reasons,
	}
}

// Exact float comparisons on purpose: the stored reasons carry these
// values bit for bit, not approximately.
#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
	use super::{StageBResult, stage_b};
	use crate::extract_landmarks::LandmarkType;
	use crate::reservoir_sample::reservoir_sample_positions;
	use crate::run::{Output, Unit, UnitMember};
	use crate::shell_quorum::shell_quorum;
	use crate::vocabulary::Vocabulary;

	type Instances<'a> = Vec<(LandmarkType, Vec<&'a str>)>;

	/// One unit as the tests write it: its key, its block (`None` for a unit
	/// no other shares a block with) and its members' tokens and instances.
	struct TestUnit<'a> {
		key: &'a str,
		block: Option<&'a str>,
		members: Vec<(Vec<&'a str>, Instances<'a>)>,
	}

	/// `count` identical members without landmark instances.
	fn unit<'a>(
		key: &'a str,
		block: Option<&'a str>,
		count: usize,
		tokens: &[&'a str],
	) -> TestUnit<'a> {
		TestUnit {
			key,
			block,
			members: vec![(tokens.to_vec(), Vec::new()); count],
		}
	}

	/// `count` identical members with the same landmark instances.
	fn unit_with_instances<'a>(
		key: &'a str,
		block: Option<&'a str>,
		count: usize,
		tokens: &[&'a str],
		instances: &[(LandmarkType, Vec<&'a str>)],
	) -> TestUnit<'a> {
		TestUnit {
			key,
			block,
			members: vec![(tokens.to_vec(), instances.to_vec()); count],
		}
	}

	/// What a run of the tests reads back.
	struct Run {
		/// Each unit's final key, in unit order.
		roots: Vec<String>,
		result: StageBResult,
		keys: Vec<String>,
	}

	impl Run {
		fn root(&self, index: usize) -> &str {
			&self.roots[index]
		}

		fn distinct_roots(&self) -> usize {
			let mut roots = self.roots.clone();
			roots.sort();
			roots.dedup();
			roots.len()
		}

		fn reason(&self, key: &str) -> &super::ClusterReason {
			&self
				.result
				.reasons
				.iter()
				.find(|(candidate, _)| candidate == key)
				.unwrap_or_else(|| panic!("no reason for {key}"))
				.1
		}
	}

	fn run_with(units: &[TestUnit], sampled: bool) -> Run {
		run_sampling(units, |_| sampled)
	}

	/// [`run_with`] where `is_sampled` says per block key whether the block
	/// was clustered from a sample.
	fn run_sampling(units: &[TestUnit], is_sampled: impl Fn(&str) -> bool) -> Run {
		let vocabulary = Vocabulary::default();
		let mut block_keys: Vec<String> = Vec::new();
		let mut output = Output::default();
		for (index, test_unit) in units.iter().enumerate() {
			let block_key = test_unit
				.block
				.map_or_else(|| format!("no-block:{}", test_unit.key), str::to_owned);
			let block = block_keys
				.iter()
				.position(|key| *key == block_key)
				.unwrap_or_else(|| {
					block_keys.push(block_key.clone());
					block_keys.len() - 1
				});
			output.keys.push(test_unit.key.to_owned());
			let id = |text: &&str| vocabulary.tokens.intern(text);
			output.units.push(Unit {
				key: u32::try_from(index).unwrap(),
				block: u32::try_from(block).unwrap(),
				members: test_unit
					.members
					.iter()
					.map(|(tokens, instances)| UnitMember {
						page_index: u32::try_from(index).unwrap(),
						tokens: tokens.iter().map(id).collect(),
						instances: instances
							.iter()
							.map(|(kind, tokens)| (*kind, tokens.iter().map(id).collect()))
							.collect(),
					})
					.collect(),
			});
			// One page per unit, carrying the unit's key.
			output.key_of_page.push(u32::try_from(index).unwrap());
		}
		output.sampled_blocks = block_keys.iter().map(|key| is_sampled(key)).collect();
		let result = stage_b(&output, &block_keys, &vocabulary);
		let roots = result
			.final_key_of_page
			.iter()
			.map(|&key| output.keys[key as usize].clone())
			.collect();
		Run {
			roots,
			result,
			keys: output.keys,
		}
	}

	fn run(units: &[TestUnit]) -> Run {
		run_with(units, false)
	}

	fn header() -> Instances<'static> {
		vec![(LandmarkType::Header, vec!["body>header>nav.c-global-nav>a"])]
	}

	#[test]
	fn empty_input_has_no_pages_and_no_reasons() {
		let run = run(&[]);
		assert!(run.result.final_key_of_page.is_empty());
		assert!(run.result.reasons.is_empty());
	}

	#[test]
	fn a_single_unit_maps_to_itself_and_keeps_every_member() {
		let run = run(&[unit("k1", None, 3, &["body>main>.card"])]);
		assert_eq!(run.root(0), "k1");
		assert_eq!(run.reason("k1").member_count, 3);
		assert_eq!(run.reason("k1").block_keys, vec!["no-block:k1"]);
	}

	#[test]
	fn two_units_with_identical_token_sets_merge_into_one() {
		let tokens = ["body>main>.card", "body>main>.title", "body>main>.body"];
		let run = run(&[unit("k1", None, 1, &tokens), unit("k2", None, 1, &tokens)]);
		assert_eq!(run.root(0), run.root(1));
		// An existing unit key survives; none is invented. The lower-numbered
		// unit is the root.
		assert_eq!(run.root(0), "k1");
	}

	#[test]
	fn two_units_with_disjoint_token_sets_stay_separate() {
		let run = run(&[
			unit(
				"k1",
				None,
				1,
				&[
					"body>main>article",
					"body>main>article>h1",
					"body>main>article>p",
				],
			),
			unit(
				"k2",
				None,
				1,
				&[
					"body>aside>section",
					"body>aside>section>ul",
					"body>footer>nav",
				],
			),
		]);
		assert_eq!(run.root(0), "k1");
		assert_eq!(run.root(1), "k2");
	}

	#[test]
	fn multi_page_units_with_one_shape_and_different_class_names_merge_via_shape_jaccard() {
		// Class-name Jaccard 0, shape Jaccard 1.
		let reports = [
			"body>main>section.c-reports",
			"body>main>section.c-reports>ul.c-reports__list",
		];
		let projects = [
			"body>main>section.c-projects",
			"body>main>section.c-projects>ul.c-projects__list",
		];
		let run = run(&[
			unit("reports", None, 2, &reports),
			unit("projects", None, 2, &projects),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn single_page_units_are_excluded_from_shape_jaccard() {
		let run = run(&[
			unit(
				"solo-a",
				None,
				1,
				&["body>main>section.type-a", "body>main>section.type-a>p"],
			),
			unit(
				"solo-b",
				None,
				1,
				&["body>main>section.type-b", "body>main>section.type-b>p"],
			),
		]);
		assert_eq!(run.root(0), "solo-a");
		assert_eq!(run.root(1), "solo-b");
	}

	#[test]
	fn every_input_unit_key_has_a_result() {
		let run = run(&[
			unit("a", None, 1, &["x"]),
			unit("b", None, 1, &["y"]),
			unit("c", None, 1, &["z"]),
		]);
		assert_eq!(run.roots, vec!["a", "b", "c"]);
		let reason_keys: Vec<&str> = run
			.result
			.reasons
			.iter()
			.map(|(key, _)| key.as_str())
			.collect();
		assert_eq!(reason_keys, vec!["a", "b", "c"]);
	}

	#[test]
	fn the_result_is_deterministic() {
		let tokens = ["body>main>.card", "body>main>.title"];
		let units = [unit("k1", None, 1, &tokens), unit("k2", None, 1, &tokens)];
		let first = run(&units);
		let second = run(&units);
		assert_eq!(first.roots, second.roots);
		assert_eq!(first.result.reasons, second.result.reasons);
	}

	#[test]
	fn units_with_landmarks_merge_when_shells_also_match() {
		let tokens = ["body>main>.content"];
		let run = run(&[
			unit_with_instances("l1", None, 1, &tokens, &header()),
			unit_with_instances("l2", None, 1, &tokens, &header()),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn a_signature_on_every_page_is_shell_without_failing() {
		// Every page has the same site-wide header: its signature has page
		// frequency 1.0, a single distinct token, so the clamp (0.8) applies.
		let landmarks = vec![(LandmarkType::Header, vec!["body>header>a"])];
		let run = run(&[unit_with_instances(
			"k",
			None,
			5,
			&["body>main>.card"],
			&landmarks,
		)]);
		assert_eq!(
			run.reason("k").landmarks[0].1.shell_tokens,
			vec!["body>header>a"]
		);
	}

	#[test]
	fn a_shared_core_header_skeleton_passes_shell_corroboration_with_a_per_page_element() {
		// Five pages' headers share a nav link and each carry their own title
		// element: per-token counting keeps the skeleton in the shell.
		let members: Vec<(Vec<&str>, Instances)> = (0..5)
			.map(|index| {
				let title: &'static str = ["p.t0", "p.t1", "p.t2", "p.t3", "p.t4"][index];
				(
					vec!["body>main>.article", "body>main>.article>.title"],
					vec![(LandmarkType::Header, vec!["body>header>nav>a", title])],
				)
			})
			.collect();
		let unit_a = TestUnit {
			key: "A",
			block: None,
			members: members.clone(),
		};
		let unit_b = TestUnit {
			key: "B",
			block: None,
			members,
		};
		let run = run(&[unit_a, unit_b]);
		assert_eq!(run.root(0), run.root(1));
		assert_eq!(
			run.reason("A").landmarks[0].1.shell_tokens,
			vec!["body>header>nav>a"]
		);
	}

	/// A unit of three pages whose headers each hold one token of their own.
	fn unit_with_varying_headers<'a>(key: &'a str, tokens: &[&'a str]) -> TestUnit<'a> {
		let headers = ["body>header>h0", "body>header>h1", "body>header>h2"];
		TestUnit {
			key,
			block: None,
			members: headers
				.iter()
				.map(|header| (tokens.to_vec(), vec![(LandmarkType::Header, vec![*header])]))
				.collect(),
		}
	}

	#[test]
	fn landmark_instances_that_vary_per_page_do_not_act_as_shell() {
		// The pair of `the_l2_stage_cannot_bypass_the_guard`: the smaller core
		// is contained in the larger, and only the shell corroboration decides.
		// Here each page's header carries a token of its own, three tokens at a
		// third of the pages each: a flat distribution, so the clamp (0.8)
		// applies and no token is shell.
		let (small_tokens, large_tokens) = l2_pair_tokens();
		let varying = run(&[
			unit_with_varying_headers("small", &small_tokens),
			unit_with_varying_headers("large", &large_tokens),
			padding(),
		]);
		assert_eq!(varying.root(0), "small");
		assert_eq!(varying.root(1), "large");
		assert_eq!(
			varying.reason("small").landmarks[0].1.shell_tokens,
			Vec::<String>::new()
		);

		// The same units with one header on every page do merge.
		let shared = run(&[
			unit_with_instances("small", None, 3, &small_tokens, &header()),
			unit_with_instances("large", None, 3, &large_tokens, &header()),
			padding(),
		]);
		assert_eq!(shared.root(0), shared.root(1));
	}

	#[test]
	fn the_shell_of_per_page_header_tokens_is_empty() {
		let vocabulary = Vocabulary::default();
		let ids: Vec<Vec<u32>> = ["body>header>h0", "body>header>h1", "body>header>h2"]
			.iter()
			.map(|token| vec![vocabulary.tokens.intern(token)])
			.collect();
		let per_page: Vec<Vec<&[u32]>> = ids.iter().map(|tokens| vec![tokens.as_slice()]).collect();
		assert_eq!(shell_quorum(&per_page), Vec::<u32>::new());
	}

	#[test]
	fn a_hub_unit_does_not_absorb_several_mutually_unrelated_units_via_containment() {
		let s1 = [
			"body>main>table>tbody>tr",
			"body>main>table>tbody>tr>td",
			"body>main>table>caption",
		];
		let s2 = ["body>main>dl>dt", "body>main>dl>dd", "body>main>dl>dt>a"];
		let s3 = [
			"body>main>form>input",
			"body>main>form>button",
			"body>main>form>label",
		];
		let mut hub_tokens: Vec<&str> = Vec::new();
		hub_tokens.extend(s1);
		hub_tokens.extend(s2);
		hub_tokens.extend(s3);
		hub_tokens.push("body>main>.hub-only-section");
		let run = run(&[
			unit("hub", None, 4, &hub_tokens),
			unit("s1", None, 4, &s1),
			unit("s2", None, 4, &s2),
			unit("s3", None, 4, &s3),
		]);
		assert_eq!(run.root(0), "hub");
		assert_eq!(run.root(1), "s1");
		assert_eq!(run.root(2), "s2");
		assert_eq!(run.root(3), "s3");
	}

	#[test]
	fn the_cohesion_guard_does_not_block_the_shape_jaccard_merge() {
		let reports = [
			"body>main>section.c-reports",
			"body>main>section.c-reports>ul.c-reports__list",
		];
		let projects = [
			"body>main>section.c-projects",
			"body>main>section.c-projects>ul.c-projects__list",
		];
		let run = run(&[
			unit("reports", None, 4, &reports),
			unit("projects", None, 4, &projects),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn units_whose_l2_signature_collapses_to_one_shape_do_not_falsely_merge() {
		// Every unit sits under the same `main>article>.wrap` chain: the L2
		// signature reduces all eight to one `main>article>*` key set, while
		// each unit's own content is a different skeleton one level deeper.
		let skeletons = [
			"body>main>article>.wrap>table>tbody>tr",
			"body>main>article>.wrap>dl>dt",
			"body>main>article>.wrap>form>input",
			"body>main>article>.wrap>ul>li",
			"body>main>article>.wrap>ol>li",
			"body>main>article>.wrap>figure>img",
			"body>main>article>.wrap>video",
			"body>main>article>.wrap>iframe",
		];
		let keys: Vec<String> = (0..skeletons.len()).map(|i| format!("t{i}")).collect();
		let extras: Vec<String> = skeletons
			.iter()
			.map(|token| format!("{token}-extra"))
			.collect();
		let units: Vec<_> = skeletons
			.iter()
			.enumerate()
			.map(|(index, token)| unit(&keys[index], None, 4, &[token, extras[index].as_str()]))
			.collect();
		let run = run(&units);
		assert_eq!(run.distinct_roots(), skeletons.len());
	}

	// -------- the Stage A separation guard --------

	fn shell() -> Vec<String> {
		(0..26).map(|i| format!("body>.shell>s{i}")).collect()
	}

	/// 12 pages without any shell token, keeping every shell token's
	/// corpus-wide document frequency far below the 90% chrome cutoff so the
	/// shell stays in the cores being compared: a shell common to one block
	/// only.
	fn padding() -> TestUnit<'static> {
		let members = (0..12)
			.map(|index| {
				let tokens: Vec<&'static str> = vec![
					Box::leak(format!("body>.padding>p{index}").into_boxed_str()),
					Box::leak(format!("body>.padding>q{index}").into_boxed_str()),
				];
				(tokens, Vec::new())
			})
			.collect();
		TestUnit {
			key: "padding",
			block: Some("path:elsewhere"),
			members,
		}
	}

	fn leak(tokens: &[String]) -> Vec<&'static str> {
		tokens
			.iter()
			.map(|token| &*Box::leak(token.clone().into_boxed_str()))
			.collect()
	}

	fn list_tokens() -> Vec<&'static str> {
		let mut tokens = shell();
		tokens.extend(
			[
				"body>.shell>list>x1",
				"body>.shell>list>x2",
				"body>.shell>list>x3",
			]
			.map(str::to_owned),
		);
		leak(&tokens)
	}

	fn detail_tokens() -> Vec<&'static str> {
		let mut tokens = shell();
		tokens.extend(
			[
				"body>.shell>detail>y1",
				"body>.shell>detail>y2",
				"body>.shell>detail>y3",
			]
			.map(str::to_owned),
		);
		leak(&tokens)
	}

	/// The token lists of two units: 15 shared tokens plus 2 against 3 own
	/// ones, the smaller `main`-anchored shape contained in the larger.
	fn l2_pair_tokens() -> (Vec<&'static str>, Vec<&'static str>) {
		let common: Vec<String> = (0..15).map(|i| format!("body>.wrap>c{i}")).collect();
		let small = [
			"body>main>article>ul>li.x1>span",
			"body>main>article>ul>li.x2>span",
		];
		let large = [
			"body>main>article>ul>li.a",
			"body>main>article>ul>li.b",
			"body>main>article>ul>li.c",
		];
		let tokens_of = |own: &[&str]| {
			let mut tokens = common.clone();
			tokens.extend(own.iter().map(|token| (*token).to_owned()));
			leak(&tokens)
		};
		(tokens_of(&small), tokens_of(&large))
	}

	#[test]
	fn precondition_without_block_information_a_list_detail_pair_sharing_a_shell_merges() {
		let run = run(&[
			unit("list", None, 4, &list_tokens()),
			unit("detail", None, 4, &detail_tokens()),
			padding(),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn same_block_multi_page_units_that_share_only_a_shell_stay_separate() {
		let run = run(&[
			unit("list", Some("path:news"), 4, &list_tokens()),
			unit("detail", Some("path:news"), 4, &detail_tokens()),
			padding(),
		]);
		assert_eq!(run.root(0), "list");
		assert_eq!(run.root(1), "detail");
	}

	#[test]
	fn units_from_different_blocks_with_the_same_cores_still_merge() {
		let run = run(&[
			unit("list", Some("path:news"), 4, &list_tokens()),
			unit("detail", Some("path:blog"), 4, &detail_tokens()),
			padding(),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn same_block_single_page_units_still_merge() {
		let keys: Vec<String> = (0..6).map(|i| format!("s{i}")).collect();
		let owned: Vec<Vec<String>> = (0..6)
			.map(|i| {
				let mut tokens = shell();
				tokens.push(format!("body>.shell>free{i}>a"));
				tokens.push(format!("body>.shell>free{i}>b"));
				tokens
			})
			.collect();
		let mut units: Vec<TestUnit> = (0..6)
			.map(|i| unit(&keys[i], Some("path:articles"), 1, &leak(&owned[i])))
			.collect();
		units.push(padding());
		let run = run(&units);
		let roots: std::collections::BTreeSet<&str> = (0..6).map(|i| run.root(i)).collect();
		assert_eq!(roots.len(), 1);
	}

	#[test]
	fn a_same_block_multi_page_pair_where_one_core_is_a_conditional_render_still_merges() {
		let mut full = shell();
		full.extend(["body>.shell>opt>e1", "body>.shell>opt>e2"].map(str::to_owned));
		let run = run(&[
			unit("full", Some("path:news"), 4, &leak(&full)),
			unit("short", Some("path:news"), 4, &leak(&shell())),
			padding(),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn a_same_block_pair_differing_only_in_the_state_of_a_shared_component_still_merges() {
		let mut first = shell();
		first.extend(["body>.shell>pager>current", "body>.shell>pager>next"].map(str::to_owned));
		let mut later = shell();
		later.extend(["body>.shell>pager>prev", "body>.shell>pager>first"].map(str::to_owned));
		let run = run(&[
			unit("first", Some("path:list"), 4, &leak(&first)),
			unit("later", Some("path:list"), 4, &leak(&later)),
			padding(),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn a_same_block_class_name_only_difference_is_exempt_from_the_guard() {
		let run = run(&[
			unit(
				"reports",
				Some("path:x"),
				3,
				&[
					"body>main>section.c-reports>ul.c-reports__list>li",
					"body>main>section.c-reports>ul.c-reports__list>a",
				],
			),
			unit(
				"projects",
				Some("path:x"),
				3,
				&[
					"body>main>section.c-projects>ul.c-projects__list>li",
					"body>main>section.c-projects>ul.c-projects__list>a",
				],
			),
		]);
		assert_eq!(run.root(0), run.root(1));
	}

	#[test]
	fn the_l2_stage_cannot_bypass_the_guard() {
		// 15 shared tokens plus 2 against 3 own tokens: complete linkage
		// (0.75), containment (0.88) and shape-Jaccard (0.88) all fall short,
		// while the `main`-anchored L2 signature of the smaller unit is
		// contained in the larger one and both share a header shell.
		let (small_tokens, large_tokens) = l2_pair_tokens();

		let merged = run(&[
			unit_with_instances("small", None, 3, &small_tokens, &header()),
			unit_with_instances("large", None, 3, &large_tokens, &header()),
			padding(),
		]);
		assert_eq!(merged.root(0), merged.root(1));

		let guarded = run(&[
			unit_with_instances("small", Some("path:x"), 3, &small_tokens, &header()),
			unit_with_instances("large", Some("path:x"), 3, &large_tokens, &header()),
			padding(),
		]);
		assert_eq!(guarded.root(0), "small");
		assert_eq!(guarded.root(1), "large");
	}

	#[test]
	fn lineage_propagates_through_pooled_groups() {
		// `a` (another block) and `b` are the same template and merge; `c` was
		// separated from `b` — and only from `b` — by Stage A. Next to root `a`
		// alone `c` would look unrelated to the guard; it is refused because
		// `b`'s lineage is pooled into `a`'s group.
		let mut own = shell();
		own.extend(["body>.shell>opt>p1", "body>.shell>opt>p2"].map(str::to_owned));
		let own = leak(&own);
		let run = run(&[
			unit("a", Some("path:other"), 4, &own),
			unit("b", Some("path:news"), 4, &own),
			unit("c", Some("path:news"), 4, &detail_tokens()),
			padding(),
		]);
		assert_eq!(run.root(0), run.root(1));
		assert_eq!(run.root(2), "c");
	}

	// -------- reasons and the pages' final keys --------

	#[test]
	fn two_clusters_split_within_one_block_are_reported_as_siblings_of_each_other() {
		let run = run(&[
			unit("card", Some("path:dept-a"), 2, &["body>main>.card"]),
			unit("form", Some("path:dept-a"), 1, &["body>main>form"]),
		]);
		assert_eq!(run.result.reasons.len(), 2);
		assert_eq!(run.reason("card").sibling_cluster_keys, vec!["form"]);
		assert_eq!(run.reason("form").sibling_cluster_keys, vec!["card"]);
		assert_eq!(run.reason("card").block_keys, run.reason("form").block_keys);
		assert_eq!(run.reason("card").block_keys, vec!["path:dept-a"]);
	}

	#[test]
	fn a_cluster_never_lists_clusters_of_other_blocks_as_siblings() {
		let run = run(&[
			unit("a", Some("path:a"), 2, &["body>main>.card"]),
			unit("b", Some("path:b"), 2, &["body>main>form"]),
		]);
		assert!(run.reason("a").sibling_cluster_keys.is_empty());
		assert!(run.reason("b").sibling_cluster_keys.is_empty());
	}

	#[test]
	fn sibling_keys_are_sorted_by_utf16_code_unit_and_exclude_the_cluster_itself() {
		// U+FF61 sorts after U+1F600 in UTF-8 but before it in UTF-16.
		let run = run(&[
			unit("main", Some("path:x"), 2, &["body>a"]),
			unit("\u{FF61}", Some("path:x"), 1, &["body>b"]),
			unit("\u{1F600}", Some("path:x"), 1, &["body>c"]),
		]);
		assert_eq!(
			run.reason("main").sibling_cluster_keys,
			vec!["\u{1F600}", "\u{FF61}"]
		);
	}

	#[test]
	fn a_merged_cluster_lists_each_of_its_blocks_once_in_unit_order() {
		let tokens = ["body>main>.card", "body>main>.title", "body>main>.body"];
		let run = run(&[
			unit("k1", Some("css:one"), 1, &tokens),
			unit("k2", Some("css:two"), 1, &tokens),
			unit("k3", Some("css:one"), 1, &tokens),
		]);
		assert_eq!(run.distinct_roots(), 1);
		let reason = run.reason("k1");
		assert_eq!(reason.member_count, 3);
		assert_eq!(reason.block_keys, vec!["css:one", "css:two"]);
		assert!(reason.sibling_cluster_keys.is_empty());
		assert_eq!(run.result.reasons.len(), 1);
	}

	#[test]
	fn reasons_come_in_the_order_the_first_unit_of_each_cluster_appears() {
		let run = run(&[
			unit("first", Some("path:a"), 1, &["body>x"]),
			unit("second", Some("path:b"), 1, &["body>y"]),
			unit("third", Some("path:c"), 1, &["body>z"]),
		]);
		let order: Vec<&str> = run
			.result
			.reasons
			.iter()
			.map(|(key, _)| key.as_str())
			.collect();
		assert_eq!(order, run.keys);
	}

	#[test]
	fn a_header_shared_across_the_cluster_reads_as_chrome_and_a_unique_nav_does_not() {
		let members = vec![
			(
				vec!["body>main>article"],
				vec![
					(LandmarkType::Header, vec!["body>nav"]),
					(LandmarkType::Nav, vec!["body>.unique-1"]),
				],
			),
			(
				vec!["body>main>article"],
				vec![
					(LandmarkType::Header, vec!["body>nav"]),
					(LandmarkType::Nav, vec!["body>.unique-2"]),
				],
			),
		];
		let run = run(&[TestUnit {
			key: "p",
			block: Some("path:p"),
			members,
		}]);
		let reason = run.reason("p");
		assert_eq!(reason.member_count, 2);
		assert_eq!(reason.landmarks[0].0, LandmarkType::Header);
		assert_eq!(reason.landmarks[0].1.chrome_rate, 1.0);
		assert_eq!(reason.landmarks[1].0, LandmarkType::Nav);
		assert_eq!(reason.landmarks[1].1.chrome_rate, 0.0);
	}

	#[test]
	fn two_distinct_clusters_each_get_their_own_shell_not_a_corpus_wide_one() {
		// Cluster A's header tokens never appear in cluster B's pages and vice
		// versa. A shell computed once over all 6 pages would give each header
		// frequency 0.5, below the clamp, and neither would read as chrome.
		let a = vec![(LandmarkType::Header, vec!["body>team-a-nav"])];
		let b = vec![(LandmarkType::Header, vec!["body>team-b-nav"])];
		let run = run(&[
			unit_with_instances("A", Some("path:team-a"), 3, &["body>main>article"], &a),
			unit_with_instances("B", Some("path:team-b"), 3, &["body>main>section"], &b),
		]);
		assert_eq!(run.result.reasons.len(), 2);
		for (_, reason) in &run.result.reasons {
			assert_eq!(reason.landmarks[0].1.chrome_rate, 1.0);
			assert_eq!(reason.member_count, 3);
		}
	}

	#[test]
	fn a_page_whose_key_no_unit_owns_keeps_its_key() {
		let vocabulary = Vocabulary::default();
		let output = Output {
			keys: vec!["unit".to_owned(), "orphan".to_owned()],
			key_of_page: vec![0, 1],
			units: vec![Unit {
				key: 0,
				block: 0,
				members: vec![UnitMember {
					page_index: 0,
					tokens: vec![vocabulary.tokens.intern("body>x")],
					instances: Vec::new(),
				}],
			}],
			sampled_blocks: Vec::new(),
		};
		let result = stage_b(&output, &["path:a".to_owned()], &vocabulary);
		assert_eq!(result.final_key_of_page, vec![0, 1]);
	}

	#[test]
	fn equal_block_keys_numbered_twice_are_one_block() {
		// The same key listed twice (blocks 0 and 1): units of both are of one
		// block, so the guard sees two big clusters of one block.
		let vocabulary = Vocabulary::default();
		let make_member = |tokens: &[&str]| UnitMember {
			page_index: 0,
			tokens: tokens
				.iter()
				.map(|token| vocabulary.tokens.intern(token))
				.collect(),
			instances: Vec::new(),
		};
		let members = |tokens: &[&str]| (0..4).map(|_| make_member(tokens)).collect::<Vec<_>>();
		let output = Output {
			keys: vec!["list".to_owned(), "detail".to_owned(), "padding".to_owned()],
			key_of_page: vec![0, 1, 2],
			units: vec![
				Unit {
					key: 0,
					block: 0,
					members: members(&list_tokens()),
				},
				Unit {
					key: 1,
					block: 1,
					members: members(&detail_tokens()),
				},
				Unit {
					key: 2,
					block: 2,
					members: (0..12)
						.map(|index| {
							make_member(&[
								&format!("body>.padding>p{index}"),
								&format!("body>.padding>q{index}"),
							])
						})
						.collect(),
				},
			],
			sampled_blocks: Vec::new(),
		};
		let blocks = [
			"path:news".to_owned(),
			"path:news".to_owned(),
			"path:x".to_owned(),
		];
		let result = stage_b(&output, &blocks, &vocabulary);
		assert_eq!(result.final_key_of_page, vec![0, 1, 2]);
	}

	// -------- the cap on groups holding a sampled unit --------

	#[test]
	fn a_sampled_block_caps_a_merged_group_at_the_block_sample_size() {
		// The pooled group lists k1's 60 members then k2's 60. The member at
		// position `p` carries one instance of landmark type `p % 6` (header,
		// footer, nav, aside, form, search), so the number of members with an
		// instance of each type says which positions were kept.
		let tokens = ["body>main>.card", "body>main>.title", "body>main>.body"];
		let members = |first_position: usize| -> Vec<(Vec<&str>, Instances)> {
			(first_position..first_position + 60)
				.map(|position| {
					(
						tokens.to_vec(),
						vec![(LandmarkType::ALL[position % 6], vec!["body>marker"])],
					)
				})
				.collect()
		};
		let units = [
			TestUnit {
				key: "k1",
				block: Some("path:a"),
				members: members(0),
			},
			TestUnit {
				key: "k2",
				block: Some("path:b"),
				members: members(60),
			},
		];
		let capped = run_with(&units, true);
		assert_eq!(capped.root(0), capped.root(1));
		let reason = capped.reason("k1");
		assert_eq!(reason.member_count, 100);

		// The positions the group is cut back to (seeded by the root's key),
		// and what they leave of each landmark type's 20 members.
		assert_eq!(
			reservoir_sample_positions(120, 100, "k1"),
			vec![
				0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 17, 18, 19, 20, 21, 23, 24, 26, 27,
				28, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 50, 52,
				53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 67, 69, 70, 72, 74, 75, 76, 77, 78,
				79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 100,
				102, 103, 104, 106, 107, 108, 109, 110, 111, 112, 114, 116, 117, 118, 119
			]
		);
		let with_instance: Vec<usize> = reason
			.landmarks
			.iter()
			.map(|(_, profile)| profile.member_count_with_instance)
			.collect();
		assert_eq!(with_instance, vec![19, 14, 17, 16, 19, 15]);

		let in_memory = run_with(&units, false);
		assert_eq!(in_memory.reason("k1").member_count, 120);
		let all_with_instance: Vec<usize> = in_memory
			.reason("k1")
			.landmarks
			.iter()
			.map(|(_, profile)| profile.member_count_with_instance)
			.collect();
		assert_eq!(all_with_instance, vec![20, 20, 20, 20, 20, 20]);
	}

	#[test]
	fn the_cap_only_binds_a_group_holding_a_unit_of_a_sampled_block() {
		let tokens = ["body>main>.card", "body>main>.title", "body>main>.body"];
		let members = || -> Vec<(Vec<&str>, Instances)> {
			(0..60).map(|_| (tokens.to_vec(), Vec::new())).collect()
		};
		let units = [
			TestUnit {
				key: "k1",
				block: Some("path:a"),
				members: members(),
			},
			TestUnit {
				key: "k2",
				block: Some("path:b"),
				members: members(),
			},
		];
		let one_sampled = run_sampling(&units, |block| block == "path:b");
		assert_eq!(one_sampled.root(0), one_sampled.root(1));
		assert_eq!(one_sampled.reason("k1").member_count, 100);

		let none_sampled = run_sampling(&units, |_| false);
		assert_eq!(none_sampled.reason("k1").member_count, 120);
	}

	#[test]
	fn a_sampled_unit_that_is_the_root_caps_the_group_it_absorbs_into() {
		let tokens = ["body>main>.card", "body>main>.title", "body>main>.body"];
		let members = || -> Vec<(Vec<&str>, Instances)> {
			(0..60).map(|_| (tokens.to_vec(), Vec::new())).collect()
		};
		let units = [
			TestUnit {
				key: "k1",
				block: Some("path:a"),
				members: members(),
			},
			TestUnit {
				key: "k2",
				block: Some("path:b"),
				members: members(),
			},
		];
		// k1, the first unit, is the root the merged group is named after.
		let sampled_root = run_sampling(&units, |block| block == "path:a");
		assert_eq!(sampled_root.root(0), sampled_root.root(1));
		assert_eq!(sampled_root.reason("k1").member_count, 100);
	}

	#[test]
	fn a_group_within_the_cap_keeps_every_member_when_sampled() {
		let tokens = ["body>main>.card", "body>main>.title"];
		let run = run_with(
			&[
				unit("k1", Some("path:a"), 30, &tokens),
				unit("k2", Some("path:b"), 30, &tokens),
			],
			true,
		);
		assert_eq!(run.reason("k1").member_count, 60);
	}
}
