//! The structured explanation of why a final cluster's pages sit together.

use crate::extract_landmarks::LandmarkType;
use crate::is_chrome_landmark_instance::{
	DEFAULT_CHROME_OVERLAP_THRESHOLD, is_chrome_landmark_instance,
};
use crate::js_string::compare_utf16;
use crate::quorum_core::compute_quorum_core;
use crate::run::UnitMember;
use crate::shell_quorum::shell_quorum;
use crate::token_view::TokenView;

/// One final cluster's common-versus-varying profile for a single landmark
/// type, from running `shell_quorum` on just that type's instances across
/// the member pages. Absent from [`ClusterReason::landmarks`] when no member
/// carries an instance of the type.
#[derive(Clone, Debug, PartialEq)]
pub struct LandmarkClusterProfile {
	/// Fraction (0–1) of the member pages carrying at least one instance of
	/// the type.
	pub presence_rate: f64,
	/// Fraction (0–1) of the type's instances, across all member pages, that
	/// `is_chrome_landmark_instance` classified as chrome against the
	/// cluster's own shell for the type: the "this header/footer is shared
	/// chrome" half of the story. The denominator is the per-page
	/// deduplicated instances (Stage A keeps one of the instances of a page
	/// that tokenize alike), so a count over raw instances would give another
	/// ratio.
	pub chrome_rate: f64,
	/// The shell tokens `shell_quorum` found for the type in this cluster,
	/// sorted as JavaScript sorts strings. Raw evidence: two sibling
	/// clusters' shells for one type show whether they share a footer but
	/// differ in having a sidebar nav.
	pub shell_tokens: Vec<String>,
	/// How many member pages carry at least one instance of the type.
	pub member_count_with_instance: usize,
}

/// A final cluster's explanation: which pages ended up together, on what
/// structure, and which sibling clusters they were split from.
///
/// Deliberately carries no verdicts ("these are the same template except
/// for X"): that judgment belongs to the caller, which has the product
/// context and the localisation needs this engine does not.
#[derive(Clone, Debug, PartialEq)]
pub struct ClusterReason {
	/// Number of pages the cluster holds (the retained members for a
	/// sampled block).
	pub member_count: usize,
	/// The distinct Pass-0 block keys that fed the cluster, in the order the
	/// cluster's units were produced. More than one means Stage B merged pages
	/// that started in different blocks, itself a notable part of the
	/// explanation. The caller attaches each key's blocking evidence.
	pub block_keys: Vec<String>,
	/// The frequency-quorum core of the cluster's pages' tokens
	/// (`compute_quorum_core`): the "this DOM structure is common" evidence,
	/// independent of CSS and landmarks. Sorted as JavaScript sorts strings.
	pub structural_core_tokens: Vec<String>,
	/// Per-landmark-type commonality, in `LandmarkType::ALL` order; types
	/// absent from every member page are omitted.
	pub landmarks: Vec<(LandmarkType, LandmarkClusterProfile)>,
	/// Final cluster keys that share a Pass-0 block with this cluster but were
	/// not merged into it, sorted as JavaScript sorts strings: candidates for
	/// "why did these split". Never includes a cluster that started in a
	/// different block.
	pub sibling_cluster_keys: Vec<String>,
}

/// `tokens` as their texts, sorted as `Array.prototype.toSorted()` sorts
/// strings: by UTF-16 code unit.
fn sorted_texts(tokens: &[u32], view: &TokenView) -> Vec<String> {
	let mut texts: Vec<String> = tokens
		.iter()
		.map(|&token| view.text(token).to_string())
		.collect();
	texts.sort_by(|a, b| compare_utf16(a, b));
	texts
}

/// One landmark type's profile over `members`, or `None` when no member
/// carries it.
fn landmark_profile(
	members: &[&UnitMember],
	landmark_type: LandmarkType,
	view: &TokenView,
) -> Option<LandmarkClusterProfile> {
	let per_member: Vec<Vec<&[u32]>> = members
		.iter()
		.map(|member| {
			member
				.instances
				.iter()
				.filter(|(kind, _)| *kind == landmark_type)
				.map(|(_, tokens)| tokens.as_slice())
				.collect()
		})
		.collect();
	let members_with_instance = per_member
		.iter()
		.filter(|instances| !instances.is_empty())
		.count();
	if members_with_instance == 0 {
		return None;
	}

	// Members without an instance stay in the list: they count toward the
	// page total the shell's frequencies divide by.
	let shell = shell_quorum(&per_member);
	let mut chrome_instances = 0usize;
	let mut total_instances = 0usize;
	for instances in per_member.iter().filter(|instances| !instances.is_empty()) {
		for tokens in instances {
			total_instances += 1;
			if is_chrome_landmark_instance(tokens, &shell, DEFAULT_CHROME_OVERLAP_THRESHOLD) {
				chrome_instances += 1;
			}
		}
	}

	// Counts stay far below 2^52; the conversions are exact.
	#[allow(clippy::cast_precision_loss)]
	let presence_rate = members_with_instance as f64 / members.len() as f64;
	#[allow(clippy::cast_precision_loss)]
	let chrome_rate = {
		// A member counted in `members_with_instance` has at least one instance.
		debug_assert!(
			total_instances > 0,
			"a member with an instance adds to the total"
		);
		chrome_instances as f64 / total_instances as f64
	};
	Some(LandmarkClusterProfile {
		presence_rate,
		chrome_rate,
		shell_tokens: sorted_texts(&shell, view),
		member_count_with_instance: members_with_instance,
	})
}

/// Builds one final cluster's [`ClusterReason`] from the pooled member state
/// Stage B already holds: no re-tokenization, no corpus-wide shell pass, only
/// per-type shells and the quorum core re-derived over this cluster's members.
///
/// `block_keys` and `sibling_cluster_keys` are passed through.
#[must_use]
pub fn build_cluster_reason(
	members: &[&UnitMember],
	block_keys: Vec<String>,
	sibling_cluster_keys: Vec<String>,
	view: &TokenView,
) -> ClusterReason {
	let token_sets: Vec<&[u32]> = members
		.iter()
		.map(|member| member.tokens.as_slice())
		.collect();
	let structural_core_tokens = sorted_texts(&compute_quorum_core(&token_sets), view);

	let landmarks = LandmarkType::ALL
		.iter()
		.filter_map(|&landmark_type| {
			landmark_profile(members, landmark_type, view).map(|profile| (landmark_type, profile))
		})
		.collect();

	ClusterReason {
		member_count: members.len(),
		block_keys,
		structural_core_tokens,
		landmarks,
		sibling_cluster_keys,
	}
}

// Exact float comparisons on purpose: the stored reasons carry these
// values bit for bit, not approximately.
#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
	use super::build_cluster_reason;
	use crate::extract_landmarks::LandmarkType;
	use crate::run::UnitMember;
	use crate::token_view::TokenView;
	use crate::vocabulary::Vocabulary;

	/// A member from token texts and `(type, tokens)` instances.
	fn member(
		vocabulary: &Vocabulary,
		tokens: &[&str],
		instances: &[(LandmarkType, &[&str])],
	) -> UnitMember {
		let id = |text: &&str| vocabulary.tokens.intern(text);
		UnitMember {
			page_index: 0,
			tokens: tokens.iter().map(id).collect(),
			instances: instances
				.iter()
				.map(|(kind, tokens)| (*kind, tokens.iter().map(id).collect()))
				.collect(),
		}
	}

	fn reason_of(vocabulary: &Vocabulary, members: &[UnitMember]) -> super::ClusterReason {
		let refs: Vec<&UnitMember> = members.iter().collect();
		build_cluster_reason(
			&refs,
			vec!["block".to_owned()],
			vec!["sibling-1".to_owned()],
			&TokenView::new(vocabulary),
		)
	}

	#[test]
	fn passes_the_block_and_sibling_keys_through_unchanged() {
		let vocabulary = Vocabulary::default();
		let reason = reason_of(&vocabulary, &[member(&vocabulary, &["a"], &[])]);
		assert_eq!(reason.block_keys, vec!["block"]);
		assert_eq!(reason.sibling_cluster_keys, vec!["sibling-1"]);
		assert_eq!(reason.member_count, 1);
	}

	#[test]
	fn the_structural_core_keeps_tokens_shared_by_the_quorum_fraction_sorted() {
		let vocabulary = Vocabulary::default();
		let members = [
			member(
				&vocabulary,
				&["body>main>.unique-a", "body>main>.card"],
				&[],
			),
			member(
				&vocabulary,
				&["body>main>.card", "body>main>.unique-b"],
				&[],
			),
			member(
				&vocabulary,
				&["body>main>.unique-c", "body>main>.card"],
				&[],
			),
		];
		let reason = reason_of(&vocabulary, &members);
		assert_eq!(reason.structural_core_tokens, vec!["body>main>.card"]);
	}

	#[test]
	fn the_structural_core_is_sorted_by_utf16_code_unit() {
		// U+FF61 sorts after U+1F600 in UTF-8 but before it in UTF-16.
		let vocabulary = Vocabulary::default();
		let members = [member(&vocabulary, &["\u{FF61}", "\u{1F600}", "a"], &[])];
		let reason = reason_of(&vocabulary, &members);
		assert_eq!(
			reason.structural_core_tokens,
			vec!["a", "\u{1F600}", "\u{FF61}"]
		);
	}

	#[test]
	fn landmarks_omit_types_with_no_instance_on_any_member() {
		let vocabulary = Vocabulary::default();
		let members = [
			member(&vocabulary, &["a"], &[]),
			member(&vocabulary, &["a"], &[]),
		];
		assert_eq!(reason_of(&vocabulary, &members).landmarks, vec![]);
	}

	#[test]
	fn a_header_and_footer_common_to_all_members_read_as_full_chrome() {
		let vocabulary = Vocabulary::default();
		let members: Vec<UnitMember> = (0..5)
			.map(|_| {
				member(
					&vocabulary,
					&["body>main>.card"],
					&[
						(LandmarkType::Header, &["header>nav>a"]),
						(LandmarkType::Footer, &["footer>p"]),
					],
				)
			})
			.collect();
		let reason = reason_of(&vocabulary, &members);
		let kinds: Vec<LandmarkType> = reason.landmarks.iter().map(|(kind, _)| *kind).collect();
		assert_eq!(kinds, vec![LandmarkType::Header, LandmarkType::Footer]);
		for (_, profile) in &reason.landmarks {
			assert_eq!(profile.presence_rate, 1.0);
			assert_eq!(profile.chrome_rate, 1.0);
			assert_eq!(profile.member_count_with_instance, 5);
		}
		assert_eq!(reason.landmarks[0].1.shell_tokens, vec!["header>nav>a"]);
	}

	#[test]
	fn a_type_on_some_members_with_varying_tokens_reads_as_partial_presence_and_not_chrome() {
		let vocabulary = Vocabulary::default();
		let header: &[&str] = &["header>nav>a"];
		let members = [
			member(
				&vocabulary,
				&["body>main>.card"],
				&[
					(LandmarkType::Header, header),
					(LandmarkType::Aside, &["aside>.promo"]),
				],
			),
			member(
				&vocabulary,
				&["body>main>.card"],
				&[
					(LandmarkType::Header, header),
					(LandmarkType::Aside, &["aside>.other"]),
				],
			),
			member(
				&vocabulary,
				&["body>main>.card"],
				&[(LandmarkType::Header, header)],
			),
			member(
				&vocabulary,
				&["body>main>.card"],
				&[(LandmarkType::Header, header)],
			),
			member(
				&vocabulary,
				&["body>main>.card"],
				&[(LandmarkType::Header, header)],
			),
		];
		let reason = reason_of(&vocabulary, &members);
		let profile_of = |kind: LandmarkType| {
			&reason
				.landmarks
				.iter()
				.find(|(candidate, _)| *candidate == kind)
				.expect("the type is present")
				.1
		};
		assert_eq!(profile_of(LandmarkType::Header).presence_rate, 1.0);
		assert_eq!(profile_of(LandmarkType::Header).chrome_rate, 1.0);
		assert_eq!(profile_of(LandmarkType::Aside).presence_rate, 0.4);
		assert_eq!(
			profile_of(LandmarkType::Aside).member_count_with_instance,
			2
		);
		assert_eq!(profile_of(LandmarkType::Aside).chrome_rate, 0.0);
		assert!(profile_of(LandmarkType::Aside).shell_tokens.is_empty());
	}

	#[test]
	fn a_nav_unique_to_each_page_is_content_while_a_shared_header_is_chrome() {
		let vocabulary = Vocabulary::default();
		let members = [
			member(
				&vocabulary,
				&["body>main>article"],
				&[
					(LandmarkType::Header, &["body>nav"]),
					(LandmarkType::Nav, &["body>.unique-1"]),
				],
			),
			member(
				&vocabulary,
				&["body>main>article"],
				&[
					(LandmarkType::Header, &["body>nav"]),
					(LandmarkType::Nav, &["body>.unique-2"]),
				],
			),
		];
		let reason = reason_of(&vocabulary, &members);
		assert_eq!(reason.member_count, 2);
		let chrome = |kind: LandmarkType| {
			reason
				.landmarks
				.iter()
				.find(|(candidate, _)| *candidate == kind)
				.map(|(_, profile)| profile.chrome_rate)
		};
		assert_eq!(chrome(LandmarkType::Header), Some(1.0));
		assert_eq!(chrome(LandmarkType::Nav), Some(0.0));
	}
}
