//! Stage B: merging Stage A's clusters across blocks.
//!
//! Units (Stage A clusters) are compared on the quorum cores of their pooled
//! pages and merged round after round until nothing merges (or
//! [`MAX_ROUNDS`] is reached); each round derives its cores again from the
//! members the merged groups now hold.
//!
//! Three mechanisms run per round, in order:
//!
//! 1. **Fine stage** — complete linkage at [`CROSS_BLOCK_THRESHOLD`] on the
//!    quorum cores, then containment assignment (0.9), then shape-Jaccard
//!    (0.9) for class-name-only differences.
//! 2. **L2 stage** (only when the fine stage found nothing) — multiset
//!    containment on `main`-anchored two-level shape signatures, with shell
//!    corroboration (the groups' landmark shells at Jaccard 0.8 or above).
//!
//! Every proposed merge then passes the Stage A separation filter and the
//! cohesion guard.
//!
//! Why quorum cores instead of strict intersection or the full union: strict
//! intersection degenerated on real crawls (89 articles sharing one
//! distinctive token had similarity 1 with everything); the full union was
//! shell-dominated (a 298-page avalanche into 4 clusters). A 80% quorum with
//! page-frequency shell removal was validated on real corpora.
//!
//! Groups are identified by the number of the unit they began as; a group
//! survives under its root's number. Nothing here orders by token id (ids
//! depend on thread timing, see `interner`): ids only stand for set members.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::assign_contained_clusters::{ContainedClusterEntry, assign_contained_clusters};
use crate::complete_linkage_dendrogram::{complete_linkage_dendrogram, labels_at_threshold};
use crate::compute_document_frequency::{DocumentFrequency, compute_document_frequency};
use crate::filter_merges_by_cohesion::filter_merges_by_cohesion;
use crate::filter_merges_by_stage_a_separation::{
	StageASeparationContext, filter_merges_by_stage_a_separation,
};
use crate::jaccard::jaccard;
use crate::l2_signature::{L2Signature, has_discriminating_signatures};
use crate::quorum_core::{compute_quorum_core, strict_quorum_core_size};
use crate::reservoir_sample::reservoir_sample_positions;
use crate::run::{Unit, UnitMember};
use crate::shell_quorum::shell_quorum;
use crate::split_tokens_by_frequency::{
	DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD, split_tokens_by_frequency,
};
use crate::stage_a_lineage::{LineageEntry, initial_lineage};
use crate::token_view::{LocalStrings, TokenView};

/// Fixed complete-linkage threshold for the cross-block fine stage.
///
/// Not auto-cut: cross-block units are few (typically 10–100 for a whole
/// site), so the merge-height distribution is too sparse for max-gap
/// detection to give a reliable cut. Without this fixed floor, auto-cut
/// chose 0.045 on an 18-unit corpus and caused spurious micro-merges.
const CROSS_BLOCK_THRESHOLD: f64 = 0.8;

/// Shape-based Jaccard threshold for "same skeleton, different class names".
/// Class-name Jaccard for reports/projects/news list pages was 0.000; shape
/// Jaccard 1.000 on real crawls.
const SHAPE_JACCARD_THRESHOLD: f64 = 0.9;

/// Minimum member-page count for a group to take part in shape-Jaccard
/// comparison. A single-page group's quorum core is its raw token set with no
/// frequency filtering, so any two one-page groups with the same tag skeleton
/// but different content would shape-merge spuriously. Multi-page groups
/// have cores that reflect a shared template, so the comparison is
/// meaningful.
const SHAPE_MIN_PAGES: usize = 2;

/// L2-stage shell corroboration threshold. Prevents cross-microsite false
/// merges: a microsite whose shell (header/nav/footer) differs from the main
/// site's would otherwise merge via L2 alone.
const SHELL_CORROBORATION_THRESHOLD: f64 = 0.8;

/// Maximum cross-block merge rounds. Real crawls converged in at most 7
/// rounds on the two validation corpora (302 and 8,936 pages).
const MAX_ROUNDS: usize = 10;

/// What a merge reads.
pub struct MergeInput<'a> {
	/// Stage A's clusters.
	pub units: &'a [Unit],
	/// Every cluster key handed out (`Output::keys`); a unit's key is the seed
	/// of the sampling that caps its group.
	pub keys: &'a [String],
	/// Each unit's block, numbered so equal numbers mean equal block keys.
	pub blocks: &'a [u32],
	/// The most members a merged group keeps, sampled back down after every
	/// merge so a chain of merges cannot balloon past the cap Stage A applied
	/// when it created the unit. Set on the streaming path only; the in-memory
	/// path keeps full membership.
	pub cap_members: Option<usize>,
}

/// Stage B's result.
pub struct MergeResult<'a> {
	/// Each unit's final root unit (a unit not absorbed into another is its
	/// own root).
	pub root_of_unit: Vec<usize>,
	/// Each surviving root's final pooled members (`None` for an absorbed
	/// unit).
	pub groups: Vec<Option<Vec<&'a UnitMember>>>,
}

/// A union-find over group positions. `union(a, b)` keeps `a`'s root,
/// whatever the numbers; which group a merge lands in is decided by the
/// callers (the first position a merged set appears at), never by the root
/// number this returns.
struct UnionFind {
	parent: Vec<usize>,
}

impl UnionFind {
	fn new(size: usize) -> Self {
		Self {
			parent: (0..size).collect(),
		}
	}

	fn find(&mut self, index: usize) -> usize {
		let mut root = index;
		while self.parent[root] != root {
			root = self.parent[root];
		}
		let mut current = index;
		while current != root {
			let next = self.parent[current];
			self.parent[current] = root;
			current = next;
		}
		root
	}

	/// Joins the sets of `a` and `b`; `a`'s root survives.
	fn union(&mut self, a: usize, b: usize) {
		let root_a = self.find(a);
		let root_b = self.find(b);
		if root_a != root_b {
			self.parent[root_b] = root_a;
		}
	}
}

/// Members' token lists as slices.
fn slices(members: &[Vec<u32>]) -> Vec<&[u32]> {
	members.iter().map(Vec::as_slice).collect()
}

/// A member's distinctive tokens against the corpus: the tokens below the
/// chrome cutoff, or all of them when every token is chrome.
fn distinctive_tokens(tokens: &[u32], corpus_frequency: &DocumentFrequency<u32>) -> Vec<u32> {
	let split = split_tokens_by_frequency(
		tokens.iter().copied(),
		corpus_frequency,
		DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD,
	);
	if split.content_tokens.is_empty() {
		tokens.to_vec()
	} else {
		split.content_tokens
	}
}

/// The class-stripped shapes of `tokens` as a set (ascending shape ids).
fn shaped_set(tokens: &[u32], view: &mut TokenView) -> Vec<u32> {
	let mut shaped: Vec<u32> = tokens.iter().map(|&token| view.shape(token)).collect();
	shaped.sort_unstable();
	shaped.dedup();
	shaped
}

/// The shell of a group's pooled landmark instances (all types together).
fn group_shell(members: &[&UnitMember]) -> Vec<u32> {
	let per_page: Vec<Vec<&[u32]>> = members
		.iter()
		.map(|member| {
			member
				.instances
				.iter()
				.map(|(_, tokens)| tokens.as_slice())
				.collect()
		})
		.collect();
	shell_quorum(&per_page)
}

/// The groups as the merge rounds change them.
struct State<'a> {
	groups: Vec<Option<Vec<&'a UnitMember>>>,
	lineage: Vec<Vec<LineageEntry>>,
	root_of_unit: Vec<usize>,
}

impl<'a> State<'a> {
	/// The units still standing as groups, ascending.
	fn alive(&self) -> Vec<usize> {
		(0..self.groups.len())
			.filter(|&unit| self.groups[unit].is_some())
			.collect()
	}

	fn members(&self, unit: usize) -> &[&'a UnitMember] {
		self.groups[unit]
			.as_deref()
			.expect("the unit is still a group")
	}

	/// Folds each absorbed group into its root: members (root's first), then
	/// lineage, then every unit that pointed at the absorbed group.
	///
	/// A round's merges name each absorbed group once and never absorb a group
	/// that is another merge's root (`merges_by_root` folds a group into the
	/// first of its set, which the filters only thin out), so every group a
	/// merge names is still standing when it is applied.
	fn apply_merges(&mut self, merges: &[(usize, usize)], input: &MergeInput) {
		for &(absorbed, root) in merges {
			let absorbed_lineage = std::mem::take(&mut self.lineage[absorbed]);
			self.lineage[root].extend(absorbed_lineage);

			let absorbed_members = self.groups[absorbed]
				.take()
				.expect("an absorbed group is absorbed once");
			let root_members = self.groups[root]
				.as_mut()
				.expect("the root is still a group");
			root_members.extend(absorbed_members);
			if let Some(cap) = input.cap_members
				&& root_members.len() > cap
			{
				let seed = &input.keys[input.units[root].key as usize];
				let kept: Vec<&UnitMember> =
					reservoir_sample_positions(root_members.len(), cap, seed)
						.into_iter()
						.map(|position| root_members[position])
						.collect();
				*root_members = kept;
			}

			for current in &mut self.root_of_unit {
				if *current == absorbed {
					*current = root;
				}
			}
			self.root_of_unit[absorbed] = root;
		}
	}
}

/// What one round derives from the groups as they stand, indexed by unit
/// (entries of absorbed units stay empty).
struct Round {
	/// The units still standing as groups, ascending.
	alive: Vec<usize>,
	/// Each group's members' class-stripped distinctive tokens, for the
	/// cohesion guard only: the fine stage's shape-Jaccard step merges units
	/// whose raw tokens are disjoint by construction (same skeleton,
	/// different BEM class names), so a cohesion check on raw tokens would
	/// reject every one of those merges. Shaped, the guard sees
	/// `section.c-reports` and `section.c-projects` both contribute to a
	/// shared `section`.
	distinctive_shaped: Vec<Vec<Vec<u32>>>,
	/// Each group's quorum core (ascending ids).
	cores: Vec<Vec<u32>>,
	/// Each group's class-stripped core (ascending shape ids).
	shaped_cores: Vec<Vec<u32>>,
}

impl Round {
	/// Derives the round's distinctive tokens (page-frequency shell removal
	/// against the corpus the groups pool) and cores.
	fn new(state: &State, view: &mut TokenView) -> Self {
		let unit_count = state.groups.len();
		let alive = state.alive();
		let corpus_frequency = compute_document_frequency(alive.iter().flat_map(|&unit| {
			state
				.members(unit)
				.iter()
				.map(|member| member.tokens.iter().copied())
		}));
		let mut distinctive_shaped: Vec<Vec<Vec<u32>>> = vec![Vec::new(); unit_count];
		let mut cores: Vec<Vec<u32>> = vec![Vec::new(); unit_count];
		let mut shaped_cores: Vec<Vec<u32>> = vec![Vec::new(); unit_count];
		for &unit in &alive {
			let distinctive: Vec<Vec<u32>> = state
				.members(unit)
				.iter()
				.map(|member| distinctive_tokens(&member.tokens, &corpus_frequency))
				.collect();
			distinctive_shaped[unit] = distinctive
				.iter()
				.map(|tokens| shaped_set(tokens, view))
				.collect();
			cores[unit] = compute_quorum_core(&slices(&distinctive));
			shaped_cores[unit] = shaped_set(&cores[unit], view);
		}
		Self {
			alive,
			distinctive_shaped,
			cores,
			shaped_cores,
		}
	}

	/// The merges the Stage A separation filter and the cohesion guard let
	/// through, from the groups' proposals.
	fn accept(
		&self,
		proposed: &[(usize, usize)],
		state: &State,
		anchors: &mut [Option<usize>],
		view: &mut TokenView,
	) -> Vec<(usize, usize)> {
		let context = StageASeparationContext {
			cores: &self.cores,
			shaped_cores: &self.shaped_cores,
			lineage: &state.lineage,
			threshold: CROSS_BLOCK_THRESHOLD,
			shape_threshold: SHAPE_JACCARD_THRESHOLD,
		};
		filter_merges_by_cohesion(
			&filter_merges_by_stage_a_separation(proposed, &context, view),
			&self.distinctive_shaped,
			anchors,
		)
	}
}

/// `(absorbed, root)` for every group that shares a union-find root with an
/// earlier one: groups fold into the first (lowest-numbered) group of their
/// root. `units[position]` is the group the union-find knows as `position`.
fn merges_by_root(units: &[usize], union_find: &mut UnionFind) -> Vec<(usize, usize)> {
	let mut first_of_root: FxHashMap<usize, usize> = FxHashMap::default();
	let mut merges = Vec::new();
	for (position, &unit) in units.iter().enumerate() {
		let root = union_find.find(position);
		match first_of_root.get(&root) {
			None => {
				first_of_root.insert(root, unit);
			}
			Some(&root_unit) => merges.push((unit, root_unit)),
		}
	}
	merges
}

/// The fine stage's proposals: complete linkage on the cores, containment
/// assignment, then shape-Jaccard for class-name-only differences.
fn propose_fine_merges(round: &Round, state: &State, view: &mut TokenView) -> Vec<(usize, usize)> {
	let alive = &round.alive;
	let n = alive.len();
	let mut uf = UnionFind::new(n);
	let core_sets: Vec<Vec<u32>> = alive
		.iter()
		.map(|&unit| round.cores[unit].clone())
		.collect();

	// Step 1: complete-linkage merges.
	let dendrogram = complete_linkage_dendrogram(&core_sets);
	let labels = labels_at_threshold(n, &dendrogram, CROSS_BLOCK_THRESHOLD);
	for (index, &label) in labels.iter().enumerate() {
		if label != index {
			uf.union(label, index);
		}
	}

	// Step 2: containment on the clusters so far, comparing token sets with
	// the anonymous wrappers collapsed so clusters differing only in those
	// are not spuriously separated.
	let mut entry_of_root: FxHashMap<usize, usize> = FxHashMap::default();
	let mut entries: Vec<ContainedClusterEntry> = Vec::new();
	for (position, core) in core_sets.iter().enumerate() {
		let root = uf.find(position);
		let slot = if let Some(&slot) = entry_of_root.get(&root) {
			slot
		} else {
			entries.push(ContainedClusterEntry {
				id: root,
				tokens: FxHashSet::default(),
				page_count: 0,
			});
			entry_of_root.insert(root, entries.len() - 1);
			entries.len() - 1
		};
		let entry = &mut entries[slot];
		for &token in core {
			entry.tokens.insert(view.collapsed(token));
		}
		entry.page_count += state.members(alive[position]).len();
	}
	// The partition the assignments induce does not depend on the order they
	// are applied in; sorted for a stable run anyway.
	let mut assignments: Vec<(usize, usize)> = assign_contained_clusters(&entries)
		.into_iter()
		.filter(|&(from, to)| from != to)
		.collect();
	assignments.sort_unstable();
	for (from, to) in assignments {
		uf.union(to, from);
	}

	// Step 3: shape-Jaccard, multi-page groups only (see SHAPE_MIN_PAGES).
	let page_counts: Vec<usize> = alive
		.iter()
		.map(|&unit| state.members(unit).len())
		.collect();
	for i in 0..n {
		for j in (i + 1)..n {
			if uf.find(i) == uf.find(j) {
				continue;
			}
			if page_counts[i] < SHAPE_MIN_PAGES || page_counts[j] < SHAPE_MIN_PAGES {
				continue;
			}
			if jaccard(&round.shaped_cores[alive[i]], &round.shaped_cores[alive[j]])
				>= SHAPE_JACCARD_THRESHOLD
			{
				let (root_i, root_j) = (uf.find(i), uf.find(j));
				uf.union(root_i, root_j);
			}
		}
	}

	merges_by_root(alive, &mut uf)
}

/// The L2 stage's proposals, or `None` when the stage cannot proceed:
/// signatures that lost all resolving power this round.
///
/// x contained in y means x is absorbed by y; several pairs can apply in one
/// round when they form consistent groups. Called only while two groups or
/// more stand (the round loop stops at one).
fn propose_l2_merges(
	round: &Round,
	state: &State,
	view: &mut TokenView,
	shape_keys: &mut LocalStrings,
) -> Option<Vec<(usize, usize)>> {
	let l2_units = state.alive();
	let l2n = l2_units.len();
	debug_assert!(l2n > 1, "the round loop stops at one group");
	let signatures: Vec<Option<L2Signature>> = l2_units
		.iter()
		.map(|&unit| L2Signature::of_core(&round.cores[unit], view, shape_keys))
		.collect();
	if !has_discriminating_signatures(signatures.iter(), shape_keys) {
		return None;
	}

	let mut shells: Vec<Option<Vec<u32>>> = vec![None; l2n];
	let mut l2_uf = UnionFind::new(l2n);
	for xi in 0..l2n {
		let Some(x_signature) = &signatures[xi] else {
			continue;
		};
		for yi in 0..l2n {
			if xi == yi || l2_uf.find(xi) == l2_uf.find(yi) {
				continue;
			}
			let Some(y_signature) = &signatures[yi] else {
				continue;
			};
			if !x_signature.is_contained_in(y_signature) {
				continue;
			}

			// Shell corroboration.
			for position in [xi, yi] {
				if shells[position].is_none() {
					shells[position] = Some(group_shell(state.members(l2_units[position])));
				}
			}
			let x_shell = shells[xi].as_deref().unwrap_or_default();
			let y_shell = shells[yi].as_deref().unwrap_or_default();
			if x_shell.is_empty()
				|| y_shell.is_empty()
				|| jaccard(x_shell, y_shell) < SHELL_CORROBORATION_THRESHOLD
			{
				continue;
			}

			l2_uf.union(yi, xi);
			// `x_signature` is stale once merged; the next round re-evaluates.
			break;
		}
	}
	Some(merges_by_root(&l2_units, &mut l2_uf))
}

/// The anchors the cohesion guard starts from: each unit's own pre-merge core
/// size (see `filter_merges_by_cohesion`). Computed the way the first
/// round's class-stripped distinctive tokens would be (document frequency
/// over the whole initial unit set), so a solo unit's anchor matches what
/// round 1 computes for it.
fn initial_anchors(units: &[Unit], view: &mut TokenView) -> Vec<Option<usize>> {
	let initial_frequency = compute_document_frequency(units.iter().flat_map(|unit| {
		unit.members
			.iter()
			.map(|member| member.tokens.iter().copied())
	}));
	units
		.iter()
		.map(|unit| {
			let shaped: Vec<Vec<u32>> = unit
				.members
				.iter()
				.map(|member| {
					shaped_set(
						&distinctive_tokens(&member.tokens, &initial_frequency),
						view,
					)
				})
				.collect();
			Some(strict_quorum_core_size(&slices(&shaped)))
		})
		.collect()
}

/// Merges Stage A's units across blocks (Stage B) by recursive quorum-core
/// comparison; see the module docs for the stages and `MergeInput` for what
/// is read.
///
/// With at most one unit there is nothing to compare: the unit is its own
/// root and keeps every member.
#[must_use]
pub fn merge_cross_block_clusters<'a>(
	input: &MergeInput<'a>,
	view: &mut TokenView,
) -> MergeResult<'a> {
	let units = input.units;
	let mut state = State {
		groups: units
			.iter()
			.map(|unit| Some(unit.members.iter().collect()))
			.collect(),
		lineage: units
			.iter()
			.enumerate()
			.map(|(index, unit)| initial_lineage(input.blocks[index], unit.members.len()))
			.collect(),
		root_of_unit: (0..units.len()).collect(),
	};
	if units.len() <= 1 {
		return MergeResult {
			root_of_unit: state.root_of_unit,
			groups: state.groups,
		};
	}

	let mut anchors = initial_anchors(units, view);
	let mut shape_keys = LocalStrings::default();
	for _ in 0..MAX_ROUNDS {
		if state.alive().len() <= 1 {
			break;
		}
		let round = Round::new(&state, view);

		let fine_merges = propose_fine_merges(&round, &state, view);
		let accepted_fine = round.accept(&fine_merges, &state, &mut anchors, view);
		if !accepted_fine.is_empty() {
			state.apply_merges(&accepted_fine, input);
			continue;
		}

		let Some(l2_merges) = propose_l2_merges(&round, &state, view, &mut shape_keys) else {
			break;
		};
		let accepted_l2 = round.accept(&l2_merges, &state, &mut anchors, view);
		if accepted_l2.is_empty() {
			// Fully converged, or every proposal was rejected.
			break;
		}
		state.apply_merges(&accepted_l2, input);
	}

	MergeResult {
		root_of_unit: state.root_of_unit,
		groups: state.groups,
	}
}

#[cfg(test)]
mod tests {
	use super::{MAX_ROUNDS, MergeInput, merge_cross_block_clusters};
	use crate::run::{Unit, UnitMember};
	use crate::token_view::TokenView;
	use crate::vocabulary::Vocabulary;

	/// A unit of `pages` identical pages holding `tokens`.
	fn unit(vocabulary: &Vocabulary, index: u32, pages: usize, tokens: &[String]) -> Unit {
		let mut ids: Vec<u32> = tokens
			.iter()
			.map(|token| vocabulary.tokens.intern(token))
			.collect();
		ids.sort_unstable();
		Unit {
			key: index,
			block: index,
			members: (0..pages)
				.map(|_| UnitMember {
					page_index: index,
					tokens: ids.clone(),
					instances: Vec::new(),
				})
				.collect(),
		}
	}

	/// `count` tokens named `body>{prefix}{n}`, each its own tag skeleton.
	fn tokens(prefix: &str, count: usize) -> Vec<String> {
		(0..count).map(|n| format!("body>{prefix}{n}")).collect()
	}

	#[test]
	fn the_rounds_are_capped_at_the_maximum() {
		// Thirteen units of five identical pages. Every unit holds the 33
		// `base` tokens; the first two add 4 tokens of their own each, the
		// others 6. Round 1 finds one pair only (the first two, similarity
		// 33/41); their pooled core drops their own tokens and becomes `base`,
		// which is similar (33/39) to each later unit but those are not similar
		// to one another (33/45) nor contained in one another, so every later
		// round folds exactly one unit into the pool. A padding unit keeps
		// `base` below the chrome cutoff of the corpus.
		let vocabulary = Vocabulary::default();
		let base = tokens("base", 33);
		let own_token_counts: [usize; 13] = [4, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6];
		let mut units: Vec<Unit> = (0..13_u32)
			.zip(own_token_counts)
			.map(|(index, own_count)| {
				let own = tokens(&format!("own{index}x"), own_count);
				let all: Vec<String> = base.iter().chain(&own).cloned().collect();
				unit(&vocabulary, index, 5, &all)
			})
			.collect();
		let mut padding = unit(&vocabulary, 13, 0, &[]);
		padding.members = (0..30)
			.map(|index| UnitMember {
				page_index: 13,
				tokens: vec![
					vocabulary.tokens.intern(&format!("body>pad{index}a")),
					vocabulary.tokens.intern(&format!("body>pad{index}b")),
				],
				instances: Vec::new(),
			})
			.collect();
		units.push(padding);

		let keys: Vec<String> = (0..14).map(|index| format!("u{index}")).collect();
		let blocks: Vec<u32> = (0..14).collect();
		let mut view = TokenView::new(&vocabulary);
		let result = merge_cross_block_clusters(
			&MergeInput {
				units: &units,
				keys: &keys,
				blocks: &blocks,
				cap_members: None,
			},
			&mut view,
		);
		assert_eq!(MAX_ROUNDS, 10);
		// Round 1 pools units 0 and 1, rounds 2 to 10 one more each (units 2
		// to 10); units 11 and 12 and the padding are left as they are.
		assert_eq!(
			result.root_of_unit,
			vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11, 12, 13]
		);
	}
}
