//! Splitting one page's tokens into template (chrome) and content by
//! document frequency.
//!
//! Comparing the two groups separately, rather than the page's full token
//! set at once, is what keeps common chrome from diluting a genuine content
//! difference and page-specific content from swamping a real layout match.

use std::hash::Hash;

use crate::compute_document_frequency::DocumentFrequency;

/// A token present on at least this fraction of the counted pages is chrome.
/// The corpora this was tuned on had cleanly bimodal frequencies (chrome on
/// 95%+ of pages, content well under 50%), so any value from 0.5 to 0.95
/// separates them alike; 0.9 sits inside that stable range, away from both
/// edges.
pub const DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD: f64 = 0.9;

/// `threshold * page_count` is a floating-point product that can overshoot
/// the integer it means (`0.55 * 100` is `55.00000000000001`), which would
/// fail the inclusive `>=` for a token exactly on the boundary. Frequencies
/// are integers, so a token truly below the boundary is at least 1 short;
/// subtracting this absorbs the rounding noise without touching any of them.
const BOUNDARY_EPSILON: f64 = 1e-9;

/// The two halves of one page's tokens, each in the order the tokens were
/// given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenSplit<T> {
	/// Tokens at or above the frequency cutoff: corpus-wide chrome.
	pub template_tokens: Vec<T>,
	/// Tokens below the cutoff, or never seen in the corpus.
	pub content_tokens: Vec<T>,
}

/// Splits `tokens` (one page's distinct tokens) by `corpus_frequency`.
///
/// A token missing from the frequency map has frequency 0, i.e. content: it
/// never appeared in the corpus, so it cannot be chrome. An empty corpus
/// (`page_count` 0) classifies everything as content for the same reason.
///
/// # Panics
///
/// Panics unless `threshold` is a fraction in `(0, 1]` (NaN included):
/// passing `90` for `0.9` would put the cutoff above every possible
/// frequency and silently misclassify universal chrome as content.
///
/// ```text
/// let corpus = compute_document_frequency(all_pages_token_sets);
/// let split = split_tokens_by_frequency(page_tokens, &corpus, 0.9);
/// ```
#[must_use]
pub fn split_tokens_by_frequency<T, I>(
	tokens: I,
	corpus_frequency: &DocumentFrequency<T>,
	threshold: f64,
) -> TokenSplit<T>
where
	T: Eq + Hash,
	I: IntoIterator<Item = T>,
{
	assert!(
		threshold > 0.0 && threshold <= 1.0,
		"split_tokens_by_frequency: threshold must be a fraction in (0, 1], got {threshold}"
	);

	let mut template_tokens = Vec::new();
	let mut content_tokens = Vec::new();

	if corpus_frequency.page_count == 0 {
		content_tokens.extend(tokens);
		return TokenSplit {
			template_tokens,
			content_tokens,
		};
	}

	// Page counts and frequencies are far below 2^53, so the conversions
	// are exact.
	#[allow(clippy::cast_precision_loss)]
	let cutoff = threshold * corpus_frequency.page_count as f64 - BOUNDARY_EPSILON;
	for token in tokens {
		let frequency = corpus_frequency
			.document_frequency
			.get(&token)
			.copied()
			.unwrap_or(0);
		#[allow(clippy::cast_precision_loss)]
		let is_template = frequency as f64 >= cutoff;
		if is_template {
			template_tokens.push(token);
		} else {
			content_tokens.push(token);
		}
	}

	TokenSplit {
		template_tokens,
		content_tokens,
	}
}

#[cfg(test)]
mod tests {
	use rustc_hash::FxHashMap;

	use super::{DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD, split_tokens_by_frequency};
	use crate::compute_document_frequency::DocumentFrequency;

	fn corpus(
		entries: &[(&'static str, usize)],
		page_count: usize,
	) -> DocumentFrequency<&'static str> {
		DocumentFrequency {
			document_frequency: entries.iter().copied().collect::<FxHashMap<_, _>>(),
			page_count,
		}
	}

	#[test]
	fn a_token_at_or_above_the_threshold_is_template() {
		let result =
			split_tokens_by_frequency(["body>header>a"], &corpus(&[("body>header>a", 9)], 10), 0.9);
		assert_eq!(result.template_tokens, vec!["body>header>a"]);
		assert!(result.content_tokens.is_empty());
	}

	#[test]
	fn a_token_below_the_threshold_is_content() {
		let result =
			split_tokens_by_frequency(["body>main>p"], &corpus(&[("body>main>p", 1)], 10), 0.9);
		assert!(result.template_tokens.is_empty());
		assert_eq!(result.content_tokens, vec!["body>main>p"]);
	}

	#[test]
	fn a_token_missing_from_the_map_is_content() {
		let result = split_tokens_by_frequency(["body>main>unseen"], &corpus(&[], 10), 0.9);
		assert_eq!(result.content_tokens, vec!["body>main>unseen"]);
		assert!(result.template_tokens.is_empty());
	}

	#[test]
	fn frequency_exactly_at_the_threshold_is_template() {
		let result = split_tokens_by_frequency(["exact"], &corpus(&[("exact", 9)], 10), 0.9);
		assert_eq!(result.template_tokens, vec!["exact"]);
	}

	#[test]
	fn frequency_on_a_boundary_the_float_product_overshoots_is_still_template() {
		// 0.55 * 100 is 55.00000000000001; a naive `>=` would fail 55.
		let result =
			split_tokens_by_frequency(["boundary"], &corpus(&[("boundary", 55)], 100), 0.55);
		assert_eq!(result.template_tokens, vec!["boundary"]);
	}

	#[test]
	fn frequency_one_short_of_a_boundary_is_content() {
		let result = split_tokens_by_frequency(["short"], &corpus(&[("short", 54)], 100), 0.55);
		assert_eq!(result.content_tokens, vec!["short"]);
	}

	#[test]
	fn the_default_threshold_is_point_nine() {
		assert_eq!(
			DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD.to_bits(),
			0.9_f64.to_bits()
		);
		let result = split_tokens_by_frequency(
			["just-below-default"],
			&corpus(&[("just-below-default", 8)], 10),
			DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD,
		);
		assert_eq!(result.content_tokens, vec!["just-below-default"]);
		assert!(result.template_tokens.is_empty());
	}

	#[test]
	fn a_custom_threshold_is_honored() {
		let counts = corpus(&[("half", 5)], 10);
		assert_eq!(
			split_tokens_by_frequency(["half"], &counts, 0.5).template_tokens,
			vec!["half"]
		);
		assert_eq!(
			split_tokens_by_frequency(["half"], &counts, 0.6).content_tokens,
			vec!["half"]
		);
	}

	#[test]
	fn no_tokens_give_two_empty_halves() {
		let result = split_tokens_by_frequency(Vec::<&str>::new(), &corpus(&[], 10), 0.9);
		assert!(result.template_tokens.is_empty());
		assert!(result.content_tokens.is_empty());
	}

	#[test]
	fn a_zero_page_corpus_classifies_everything_as_content() {
		let result = split_tokens_by_frequency(["anything"], &corpus(&[], 0), 0.9);
		assert_eq!(result.content_tokens, vec!["anything"]);
		assert!(result.template_tokens.is_empty());
	}

	#[test]
	fn splits_a_mix_keeping_the_given_order_in_each_half() {
		let counts = corpus(
			&[
				("chrome-a", 10),
				("chrome-b", 9),
				("content-a", 2),
				("content-b", 1),
			],
			10,
		);
		let result = split_tokens_by_frequency(
			["content-b", "chrome-b", "content-a", "chrome-a"],
			&counts,
			0.9,
		);
		assert_eq!(result.template_tokens, vec!["chrome-b", "chrome-a"]);
		assert_eq!(result.content_tokens, vec!["content-b", "content-a"]);
	}

	#[test]
	fn splits_interned_integer_tokens() {
		let counts = DocumentFrequency {
			document_frequency: [(7_u32, 10_usize), (8_u32, 1_usize)].into_iter().collect(),
			page_count: 10,
		};
		let result = split_tokens_by_frequency([7_u32, 8, 9], &counts, 0.9);
		assert_eq!(result.template_tokens, vec![7]);
		assert_eq!(result.content_tokens, vec![8, 9]);
	}

	#[test]
	fn accepts_a_threshold_of_exactly_one() {
		let result = split_tokens_by_frequency(["always"], &corpus(&[("always", 10)], 10), 1.0);
		assert_eq!(result.template_tokens, vec!["always"]);
	}

	#[test]
	#[should_panic(expected = "threshold must be a fraction in (0, 1]")]
	fn rejects_zero() {
		let _ = split_tokens_by_frequency(["a"], &corpus(&[], 10), 0.0);
	}

	#[test]
	#[should_panic(expected = "threshold must be a fraction in (0, 1]")]
	fn rejects_a_negative_threshold() {
		let _ = split_tokens_by_frequency(["a"], &corpus(&[], 10), -0.5);
	}

	#[test]
	#[should_panic(expected = "threshold must be a fraction in (0, 1]")]
	fn rejects_a_percentage() {
		let _ = split_tokens_by_frequency(["a"], &corpus(&[], 10), 90.0);
	}

	#[test]
	#[should_panic(expected = "threshold must be a fraction in (0, 1]")]
	fn rejects_nan() {
		let _ = split_tokens_by_frequency(["a"], &corpus(&[], 10), f64::NAN);
	}
}
