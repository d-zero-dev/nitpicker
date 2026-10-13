//! Stage A's block-local verdict, enforced on Stage B's merge proposals.

use indexmap::IndexMap;
use rustc_hash::FxHashSet;

use crate::are_stage_a_separated::are_stage_a_separated;
use crate::jaccard::jaccard;
use crate::stage_a_lineage::LineageEntry;
use crate::token_view::TokenView;

/// Structural tokens (tokens whose parent path the other core does not
/// render) a core must hold, on each side, for a pair Stage A separated to
/// stay separated. Fewer on either side reads as a conditional render of the
/// same template (an optional section present on one side only), not a
/// different template.
pub const MIN_EXCLUSIVE_TOKENS: usize = 2;

/// What the filter reads about the groups of a round, all indexed by group
/// (unit) number; a group missing from a list reads as an empty core or an
/// empty lineage.
pub struct StageASeparationContext<'a> {
	/// Each group's quorum core (ascending ids).
	pub cores: &'a [Vec<u32>],
	/// Each group's class-stripped core (ascending shape ids).
	pub shaped_cores: &'a [Vec<u32>],
	/// The Stage A clusters each group pools.
	pub lineage: &'a [Vec<LineageEntry>],
	/// Core similarity below which a pair counts as merely class-name-alike.
	pub threshold: f64,
	/// Class-stripped similarity at or above which it does.
	pub shape_threshold: f64,
}

/// How many of `a`'s tokens are structurally exclusive against `b`: not in
/// `b`, and with a parent path no token of `b` shares. A token whose
/// container `b` also renders (the other state of a pager, a different
/// item of the same list) is variation of a shared component, not structure
/// `b` lacks.
fn count_structural_exclusive(a: &[u32], b: &[u32], view: &mut TokenView) -> usize {
	let b_parents: FxHashSet<u32> = b.iter().map(|&token| view.parent(token)).collect();
	let mut count = 0;
	for &token in a {
		if b.binary_search(&token).is_err() && !b_parents.contains(&view.parent(token)) {
			count += 1;
		}
	}
	count
}

/// Whether merging `absorbed` into a group containing `member` is refused:
/// Stage A separated them, each side has structure of its own, and they are
/// not a class-name-only difference.
fn is_vetoed(
	absorbed: usize,
	member: usize,
	context: &StageASeparationContext,
	view: &mut TokenView,
) -> bool {
	let empty_lineage: &[LineageEntry] = &[];
	let lineage_of = |group: usize| -> &[LineageEntry] {
		context
			.lineage
			.get(group)
			.map_or(empty_lineage, Vec::as_slice)
	};
	if !are_stage_a_separated(lineage_of(absorbed), lineage_of(member)) {
		return false;
	}

	let empty: &[u32] = &[];
	let core_of =
		|group: usize| -> &[u32] { context.cores.get(group).map_or(empty, Vec::as_slice) };
	let shaped_of =
		|group: usize| -> &[u32] { context.shaped_cores.get(group).map_or(empty, Vec::as_slice) };
	let absorbed_core = core_of(absorbed);
	let member_core = core_of(member);
	if count_structural_exclusive(absorbed_core, member_core, view) < MIN_EXCLUSIVE_TOKENS
		|| count_structural_exclusive(member_core, absorbed_core, view) < MIN_EXCLUSIVE_TOKENS
	{
		return false;
	}

	let raw_similarity = jaccard(absorbed_core, member_core);
	let shaped_similarity = jaccard(shaped_of(absorbed), shaped_of(member));
	let class_name_only =
		raw_similarity < context.threshold && shaped_similarity >= context.shape_threshold;
	!class_name_only
}

/// Filters a round's proposed `(absorbed, root)` merges, refusing any whose
/// absorbed group Stage A had already separated, with real evidence, from
/// the root or from a group already accepted into that root.
///
/// ## What counts as evidence
///
/// A pair is refused when `are_stage_a_separated` holds for their lineages
/// and, in the cores Stage B compares, each side keeps at least
/// [`MIN_EXCLUSIVE_TOKENS`] structural tokens the other lacks. A pair that
/// only looks alike once class names are stripped (raw similarity under the
/// threshold, class-stripped at or above the shape threshold) is exempt: that
/// is the case the shape-Jaccard step exists for.
///
/// ## Order
///
/// Proposals are checked in the order given, each against the root and the
/// proposals already accepted for that root; a refused proposal is not
/// remembered as a member. Which of two mutually separated groups a root
/// keeps therefore depends on proposal order.
#[must_use]
pub fn filter_merges_by_stage_a_separation(
	proposed_merges: &[(usize, usize)],
	context: &StageASeparationContext,
	view: &mut TokenView,
) -> Vec<(usize, usize)> {
	let mut accepted_by_root: IndexMap<usize, Vec<usize>> = IndexMap::new();
	let mut kept = Vec::new();
	for &(absorbed, root) in proposed_merges {
		let accepted = accepted_by_root.entry(root).or_default();
		let members: Vec<usize> = std::iter::once(root)
			.chain(accepted.iter().copied())
			.collect();
		if members
			.into_iter()
			.any(|member| is_vetoed(absorbed, member, context, view))
		{
			continue;
		}
		accepted_by_root
			.get_mut(&root)
			.expect("the root's entry was just created")
			.push(absorbed);
		kept.push((absorbed, root));
	}
	kept
}

#[cfg(test)]
mod tests {
	use super::{
		MIN_EXCLUSIVE_TOKENS, StageASeparationContext, filter_merges_by_stage_a_separation,
	};
	use crate::jaccard::sorted_set;
	use crate::stage_a_lineage::LineageEntry;
	use crate::token_view::TokenView;
	use crate::vocabulary::Vocabulary;

	/// Group numbers of the fixtures below.
	const A: usize = 0;
	const B: usize = 1;
	const C: usize = 2;
	const ROOT: usize = 3;
	const X: usize = 4;
	const Y: usize = 5;

	fn shared() -> Vec<String> {
		(0..10).map(|i| format!("body>.shell>s{i}")).collect()
	}

	fn owned(tokens: &[String]) -> Vec<String> {
		tokens.to_vec()
	}

	fn with(base: &[String], extra: &[&str]) -> Vec<String> {
		let mut tokens = owned(base);
		tokens.extend(extra.iter().map(|token| (*token).to_owned()));
		tokens
	}

	fn entry(block: u32, page_count: usize) -> LineageEntry {
		LineageEntry { block, page_count }
	}

	/// A context over `groups` (each `Some((core, lineage))` or missing),
	/// class-stripped cores defaulting to the cores themselves.
	struct Fixture {
		vocabulary: Vocabulary,
		cores: Vec<Vec<u32>>,
		shaped: Vec<Vec<u32>>,
		lineage: Vec<Vec<LineageEntry>>,
	}

	impl Fixture {
		fn new(
			groups: &[(usize, Vec<String>, Vec<LineageEntry>)],
			shaped: &[(usize, Vec<String>)],
		) -> Self {
			let vocabulary = Vocabulary::default();
			let size = 6;
			let mut cores = vec![Vec::new(); size];
			let mut shaped_cores = vec![Vec::new(); size];
			let mut lineage = vec![Vec::new(); size];
			for (group, tokens, entries) in groups {
				let ids: Vec<u32> = tokens
					.iter()
					.map(|token| vocabulary.tokens.intern(token))
					.collect();
				// Class-stripped by default: the cores' own ids stand in as shape ids.
				shaped_cores[*group] = sorted_set(&ids);
				cores[*group] = sorted_set(&ids);
				lineage[*group].clone_from(entries);
			}
			for (group, tokens) in shaped {
				let ids: Vec<u32> = tokens
					.iter()
					.map(|token| vocabulary.tokens.intern(token))
					.collect();
				shaped_cores[*group] = sorted_set(&ids);
			}
			Self {
				vocabulary,
				cores,
				shaped: shaped_cores,
				lineage,
			}
		}

		fn run(
			&self,
			proposals: &[(usize, usize)],
			threshold: f64,
			shape_threshold: f64,
		) -> Vec<(usize, usize)> {
			let mut view = TokenView::new(&self.vocabulary);
			filter_merges_by_stage_a_separation(
				proposals,
				&StageASeparationContext {
					cores: &self.cores,
					shaped_cores: &self.shaped,
					lineage: &self.lineage,
					threshold,
					shape_threshold,
				},
				&mut view,
			)
		}

		fn filter(&self, proposals: &[(usize, usize)]) -> Vec<(usize, usize)> {
			self.run(proposals, 0.8, 0.9)
		}
	}

	fn separated() -> Vec<LineageEntry> {
		vec![entry(0, 5)]
	}

	#[test]
	fn vetoes_a_merge_stage_a_separated_when_each_core_keeps_its_own_structure() {
		assert_eq!(MIN_EXCLUSIVE_TOKENS, 2);
		let fixture = Fixture::new(
			&[
				(
					A,
					with(&shared(), &["body>.shell>list>x1", "body>.shell>list>x2"]),
					separated(),
				),
				(
					ROOT,
					with(
						&shared(),
						&["body>.shell>detail>y1", "body>.shell>detail>y2"],
					),
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![]);
	}

	#[test]
	fn keeps_a_merge_when_the_absorbed_side_has_fewer_than_the_minimum() {
		let fixture = Fixture::new(
			&[
				(A, with(&shared(), &["body>.shell>list>x1"]), separated()),
				(
					ROOT,
					with(
						&shared(),
						&["body>.shell>detail>y1", "body>.shell>detail>y2"],
					),
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![(A, ROOT)]);
	}

	#[test]
	fn keeps_a_merge_when_the_root_side_has_fewer_than_the_minimum() {
		let fixture = Fixture::new(
			&[
				(
					A,
					with(&shared(), &["body>.shell>list>x1", "body>.shell>list>x2"]),
					separated(),
				),
				(
					ROOT,
					with(&shared(), &["body>.shell>detail>y1"]),
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![(A, ROOT)]);
	}

	#[test]
	fn a_vetoed_proposal_is_not_remembered_as_a_member_of_the_root() {
		// `x` is vetoed against `root`. `y` has exactly root's core (nothing to
		// veto against `root`) but Stage A separated it from `x` as well; if the
		// vetoed `x` were counted as a member of `root`, `y` would be refused.
		let root_tokens = with(
			&shared(),
			&["body>.shell>detail>y1", "body>.shell>detail>y2"],
		);
		let fixture = Fixture::new(
			&[
				(ROOT, root_tokens.clone(), separated()),
				(
					X,
					with(&shared(), &["body>.shell>list>x1", "body>.shell>list>x2"]),
					separated(),
				),
				(Y, root_tokens, separated()),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(X, ROOT), (Y, ROOT)]), vec![(Y, ROOT)]);
	}

	/// The three-group fixture of the order tests: `a` is of another block
	/// than `b` and `c`, which Stage A separated.
	fn order_fixture() -> Fixture {
		Fixture::new(
			&[
				(
					A,
					with(&shared(), &["body>.shell>opt>p1", "body>.shell>opt>p2"]),
					vec![entry(1, 5)],
				),
				(
					B,
					with(&shared(), &["body>.shell>opt>p1", "body>.shell>opt>p2"]),
					vec![entry(2, 5)],
				),
				(
					C,
					with(
						&shared(),
						&["body>.shell>detail>y1", "body>.shell>detail>y2"],
					),
					vec![entry(2, 5)],
				),
			],
			&[],
		)
	}

	#[test]
	fn the_outcome_depends_on_proposal_order() {
		// `c` is accepted first (nothing separates it from root `a`), so `b`,
		// which Stage A kept apart from `c`, is refused.
		assert_eq!(order_fixture().filter(&[(C, A), (B, A)]), vec![(C, A)]);
	}

	#[test]
	fn checks_a_proposal_against_groups_already_accepted_into_the_same_root() {
		// `b` first: once it is accepted into `a`, `c` (kept apart from `b`)
		// must be refused.
		assert_eq!(order_fixture().filter(&[(B, A), (C, A)]), vec![(B, A)]);
	}

	#[test]
	fn a_pair_exactly_at_the_raw_threshold_is_not_exempt_one_exactly_at_the_shape_threshold_is() {
		let shared8: Vec<String> = (0..8).map(|i| format!("body>.shell>s{i}")).collect();
		// Raw Jaccard is 8 / 12 (8 shared, 2 exclusive per side).
		let cores = [
			(
				A,
				with(&shared8, &["body>.shell>list>x1", "body>.shell>list>x2"]),
				separated(),
			),
			(
				ROOT,
				with(
					&shared8,
					&["body>.shell>detail>y1", "body>.shell>detail>y2"],
				),
				separated(),
			),
		];
		let raw_jaccard = 8.0 / 12.0;
		// Class-stripped cores that reach the shape threshold exactly (8 / 10).
		let shaped = [
			(A, with(&shared8, &["body>.shell>x"])),
			(ROOT, with(&shared8, &["body>.shell>y"])),
		];
		let shaped_jaccard = 8.0 / 10.0;
		let fixture = Fixture::new(&cores, &shaped);

		// Raw similarity equal to the threshold is "already similar": not
		// exempt, even though the class-stripped cores would qualify.
		assert_eq!(
			fixture.run(&[(A, ROOT)], raw_jaccard, shaped_jaccard),
			vec![]
		);
		// One step below the raw threshold, shaped similarity equal to its
		// threshold qualifies for the exemption.
		assert_eq!(
			fixture.run(&[(A, ROOT)], raw_jaccard + 0.01, shaped_jaccard),
			vec![(A, ROOT)]
		);
		// One step above the shape threshold it does not.
		assert_eq!(
			fixture.run(&[(A, ROOT)], raw_jaccard + 0.01, shaped_jaccard + 0.01),
			vec![]
		);
	}

	#[test]
	fn a_token_without_a_gt_has_an_empty_parent_path_no_nested_token_shares() {
		let fixture = Fixture::new(
			&[
				(A, vec!["x1".to_owned(), "x2".to_owned()], separated()),
				(
					ROOT,
					vec!["body>y1".to_owned(), "body>y2".to_owned()],
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![]);
	}

	#[test]
	fn a_group_without_a_core_falls_back_to_an_empty_core_and_is_not_vetoed() {
		let fixture = Fixture::new(&[(A, shared(), separated())], &[]);
		// `ROOT` has no core and no lineage in the fixture.
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![(A, ROOT)]);
	}

	#[test]
	fn keeps_a_merge_whose_exclusive_tokens_sit_under_a_container_the_other_renders() {
		let fixture = Fixture::new(
			&[
				(
					A,
					with(
						&shared(),
						&["body>.shell>pager>current", "body>.shell>pager>next"],
					),
					separated(),
				),
				(
					ROOT,
					with(
						&shared(),
						&["body>.shell>pager>prev", "body>.shell>pager>first"],
					),
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![(A, ROOT)]);
	}

	#[test]
	fn keeps_a_merge_when_stage_a_did_not_separate_the_groups() {
		let fixture = Fixture::new(
			&[
				(
					A,
					with(&shared(), &["body>.shell>list>x1", "body>.shell>list>x2"]),
					vec![entry(1, 5)],
				),
				(
					ROOT,
					with(
						&shared(),
						&["body>.shell>detail>y1", "body>.shell>detail>y2"],
					),
					vec![entry(2, 5)],
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![(A, ROOT)]);
	}

	#[test]
	fn keeps_a_merge_when_either_group_has_no_lineage() {
		let fixture = Fixture::new(
			&[
				(
					A,
					with(&shared(), &["body>.shell>list>x1", "body>.shell>list>x2"]),
					vec![],
				),
				(
					ROOT,
					with(
						&shared(),
						&["body>.shell>detail>y1", "body>.shell>detail>y2"],
					),
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![(A, ROOT)]);
	}

	#[test]
	fn exempts_a_class_name_only_difference() {
		let fixture = Fixture::new(
			&[
				(
					A,
					vec![
						"body>main>section.c-reports>ul.c-reports__list>li".to_owned(),
						"body>main>section.c-reports>ul.c-reports__list>a".to_owned(),
					],
					separated(),
				),
				(
					ROOT,
					vec![
						"body>main>section.c-projects>ul.c-projects__list>li".to_owned(),
						"body>main>section.c-projects>ul.c-projects__list>a".to_owned(),
					],
					separated(),
				),
			],
			&[
				(
					A,
					vec![
						"body>main>section>ul>li".to_owned(),
						"body>main>section>ul>a".to_owned(),
					],
				),
				(
					ROOT,
					vec![
						"body>main>section>ul>li".to_owned(),
						"body>main>section>ul>a".to_owned(),
					],
				),
			],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![(A, ROOT)]);
	}

	#[test]
	fn does_not_exempt_a_pair_already_similar_on_raw_tokens() {
		// 20 shared tokens + 2 exclusive each → raw Jaccard 20/24 ≈ 0.83, above
		// the 0.8 threshold: the exemption is for pairs that only look alike
		// once class names are stripped, not for pairs that already match.
		let shared20: Vec<String> = (0..20).map(|i| format!("body>.shell>s{i}")).collect();
		let fixture = Fixture::new(
			&[
				(
					A,
					with(&shared20, &["body>.shell>list>x1", "body>.shell>list>x2"]),
					separated(),
				),
				(
					ROOT,
					with(
						&shared20,
						&["body>.shell>detail>y1", "body>.shell>detail>y2"],
					),
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT)]), vec![]);
	}

	#[test]
	fn filters_each_proposal_independently_and_preserves_order() {
		let fixture = Fixture::new(
			&[
				(
					A,
					with(&shared(), &["body>.shell>list>x1", "body>.shell>list>x2"]),
					separated(),
				),
				(
					B,
					with(
						&shared(),
						&["body>.shell>pager>current", "body>.shell>pager>next"],
					),
					separated(),
				),
				(
					ROOT,
					with(
						&shared(),
						&[
							"body>.shell>detail>y1",
							"body>.shell>detail>y2",
							"body>.shell>pager>prev",
							"body>.shell>pager>first",
						],
					),
					separated(),
				),
			],
			&[],
		);
		assert_eq!(fixture.filter(&[(A, ROOT), (B, ROOT)]), vec![(B, ROOT)]);
	}
}
