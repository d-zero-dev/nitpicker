//! Stage B's L2 comparison: `main`-anchored two-level shape signatures.

use rustc_hash::FxHashMap;

use crate::js_string::compare_utf16;
use crate::token_view::{LocalStrings, TokenView};

/// Segments carrying no structural information at L2 resolution: a token
/// whose content segments (those after `main`) are all generic is excluded
/// from the signature as uninformative.
const GENERIC_SEGMENTS: [&str; 12] = [
	"div", "span", "*", "script", "noscript", "style", "iframe", "a", "br", "img", "picture",
	"source",
];

/// Whether a segment is the `main` element (bare, bracketed or classed).
fn is_main_segment(segment: &str) -> bool {
	segment == "main" || segment.starts_with("main[") || segment.starts_with("main.")
}

/// A group's L2 signature: how many of its core's tokens fall under each
/// `main`-anchored shape (`main` plus up to two levels after it, classes
/// stripped). The keys are ids of a table the caller owns.
pub struct L2Signature {
	counts: FxHashMap<u32, u32>,
}

impl L2Signature {
	/// The signature of `core`, or `None` when no token of it has an
	/// informative `main`-anchored shape.
	///
	/// Splits the class-stripped token on every `>`, including one inside a
	/// class name or a bracket, as the stored keys were computed.
	pub fn of_core(
		core: &[u32],
		view: &mut TokenView,
		shape_keys: &mut LocalStrings,
	) -> Option<Self> {
		let mut counts: FxHashMap<u32, u32> = FxHashMap::default();
		for &token in core {
			let shape = view.shape(token);
			let segments: Vec<&str> = view.shape_text(shape).split('>').collect();
			let Some(main_index) = segments.iter().position(|s| is_main_segment(s)) else {
				continue;
			};

			// `main` plus up to two levels after it.
			let end = segments.len().min(main_index + 3);
			let truncated = &segments[main_index..end];
			let content_segments = &truncated[1..];

			// No content segment at all, or only generic ones: skip.
			if content_segments
				.iter()
				.all(|segment| GENERIC_SEGMENTS.contains(segment))
			{
				continue;
			}

			let key = shape_keys.intern(&truncated.join(">"));
			*counts.entry(key).or_insert(0) += 1;
		}
		if counts.is_empty() {
			None
		} else {
			Some(Self { counts })
		}
	}

	/// Whether `self`'s shapes are contained in `other`'s as a multiset:
	/// every shape occurs in `other` at least as often as in `self`.
	#[must_use]
	pub fn is_contained_in(&self, other: &Self) -> bool {
		self.counts
			.iter()
			.all(|(key, &count)| count <= other.counts.get(key).copied().unwrap_or(0))
	}

	/// A canonical id for the signature's shape — its keys sorted and joined
	/// by a space, ignoring the counts — so two groups that reduced to the
	/// same vocabulary of shapes compare equal however many pages
	/// contributed. The join is the identity itself, so keys that contain a
	/// space are compared as the joined text, as the stored keys were
	/// computed.
	#[must_use]
	pub fn shape_id(&self, shape_keys: &LocalStrings) -> String {
		let mut keys: Vec<&str> = self.counts.keys().map(|&id| shape_keys.text(id)).collect();
		keys.sort_by(|a, b| compare_utf16(a, b));
		keys.join(" ")
	}
}

/// Whether this round's L2 signatures carry any discriminating power,
/// checked once per round before the quadratic containment comparison.
///
/// The signature truncates to `main` plus two shape-stripped levels. A
/// corpus whose real template content sits under one shared `main > article >
/// wrapper` chain reduces every group to the same few keys, at which point
/// multiset containment degenerates into a plain count comparison with no
/// structural meaning; running it would only produce merges the cohesion
/// guard then has to catch. Only total collapse (all participants share one
/// shape) is detected; partial collapse still relies on the cohesion guard.
///
/// Below [`MIN_PARTICIPANTS_FOR_DEGENERACY_CHECK`] participants, "every
/// group shares one shape" is unremarkable — there is nothing to
/// discriminate between yet — so the signature is not judged to lack
/// resolving power.
#[must_use]
pub fn has_discriminating_signatures<'a>(
	signatures: impl IntoIterator<Item = &'a Option<L2Signature>>,
	shape_keys: &LocalStrings,
) -> bool {
	let mut shape_ids: Vec<String> = Vec::new();
	let mut participant_count = 0;
	for signature in signatures {
		let Some(signature) = signature else {
			continue;
		};
		participant_count += 1;
		let id = signature.shape_id(shape_keys);
		if !shape_ids.contains(&id) {
			shape_ids.push(id);
		}
		if shape_ids.len() > 1 {
			return true;
		}
	}
	participant_count < MIN_PARTICIPANTS_FOR_DEGENERACY_CHECK
}

/// Minimum number of groups a degeneracy check requires before it rejects
/// the whole comparison.
pub const MIN_PARTICIPANTS_FOR_DEGENERACY_CHECK: usize = 3;

#[cfg(test)]
mod tests {
	use super::{L2Signature, has_discriminating_signatures};
	use crate::token_view::{LocalStrings, TokenView};
	use crate::vocabulary::Vocabulary;

	/// The signature of a core given as token texts.
	fn signature(
		tokens: &[&str],
		vocabulary: &Vocabulary,
		keys: &mut LocalStrings,
	) -> Option<L2Signature> {
		let mut view = TokenView::new(vocabulary);
		let ids: Vec<u32> = tokens
			.iter()
			.map(|token| vocabulary.tokens.intern(token))
			.collect();
		L2Signature::of_core(&ids, &mut view, keys)
	}

	#[test]
	fn counts_the_main_anchored_shapes_with_main_and_two_levels() {
		let vocabulary = Vocabulary::default();
		let mut keys = LocalStrings::default();
		let result = signature(
			&[
				"body>main>article.c-a>ul.x>li",
				"body>main>article.c-b>ul.y>li",
				"body>main>section>p",
			],
			&vocabulary,
			&mut keys,
		)
		.expect("informative tokens");
		// `main>article>ul` twice, `main>section>p` once.
		assert_eq!(result.shape_id(&keys), "main>article>ul main>section>p");
		let mut counts: Vec<u32> = result.counts.values().copied().collect();
		counts.sort_unstable();
		assert_eq!(counts, vec![1, 2]);
	}

	#[test]
	fn skips_tokens_without_main_or_with_only_generic_content() {
		let vocabulary = Vocabulary::default();
		let mut keys = LocalStrings::default();
		assert!(
			signature(
				&[
					"body>aside>ul",
					"body>main",
					"body>main>div>span",
					"body>main>.card>img",
				],
				&vocabulary,
				&mut keys,
			)
			.is_none()
		);
	}

	#[test]
	fn recognises_main_with_a_bracket_or_a_class() {
		let vocabulary = Vocabulary::default();
		let mut keys = LocalStrings::default();
		let result = signature(
			&["body>main[role=main]>form", "body>main.wrap>table>tr"],
			&vocabulary,
			&mut keys,
		)
		.expect("informative tokens");
		// Classes are stripped by the shape: `main.wrap` is `main`.
		assert_eq!(result.shape_id(&keys), "main>table>tr main[role=main]>form");
	}

	#[test]
	fn containment_is_multiset_containment() {
		let vocabulary = Vocabulary::default();
		let mut keys = LocalStrings::default();
		let one = signature(&["body>main>ul>li"], &vocabulary, &mut keys).unwrap();
		let two = signature(
			&["body>main>ul>li", "body>main>ul>li.x", "body>main>ol>li"],
			&vocabulary,
			&mut keys,
		)
		.unwrap();
		// `main>ul>li` once against twice.
		assert!(one.is_contained_in(&two));
		assert!(!two.is_contained_in(&one));
		assert!(one.is_contained_in(&one));
	}

	#[test]
	fn the_shape_id_ignores_the_counts_and_orders_keys_by_utf16() {
		let vocabulary = Vocabulary::default();
		let mut keys = LocalStrings::default();
		let a = signature(
			&["body>main>b>x", "body>main>a>x", "body>main>a>x.y"],
			&vocabulary,
			&mut keys,
		)
		.unwrap();
		let b = signature(&["body>main>a>x", "body>main>b>x"], &vocabulary, &mut keys).unwrap();
		assert_eq!(a.shape_id(&keys), b.shape_id(&keys));
		assert_eq!(a.shape_id(&keys), "main>a>x main>b>x");
	}

	#[test]
	fn discriminates_once_two_shapes_differ() {
		let vocabulary = Vocabulary::default();
		let mut keys = LocalStrings::default();
		let a = signature(&["body>main>a>x"], &vocabulary, &mut keys);
		let b = signature(&["body>main>b>x"], &vocabulary, &mut keys);
		let c = signature(&["body>main>a>x"], &vocabulary, &mut keys);
		assert!(has_discriminating_signatures([&a, &b, &c], &keys));
	}

	#[test]
	fn total_collapse_of_three_or_more_participants_does_not_discriminate() {
		let vocabulary = Vocabulary::default();
		let mut keys = LocalStrings::default();
		let a = signature(&["body>main>a>x"], &vocabulary, &mut keys);
		let b = signature(&["body>main>a>x"], &vocabulary, &mut keys);
		let c = signature(&["body>main>a>x"], &vocabulary, &mut keys);
		assert!(!has_discriminating_signatures([&a, &b, &c], &keys));
		// Two participants are too few to judge.
		assert!(has_discriminating_signatures([&a, &b], &keys));
		// Groups without a signature do not participate.
		let none: Option<L2Signature> = None;
		assert!(has_discriminating_signatures([&a, &none, &b], &keys));
		assert!(!has_discriminating_signatures([&a, &none, &b, &c], &keys));
	}
}
