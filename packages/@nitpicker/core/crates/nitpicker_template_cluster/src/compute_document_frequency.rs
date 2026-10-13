//! Document frequency: in how many of a corpus's token sets each token occurs.
//!
//! Generic over the token type so the same count serves Pass 0 (stylesheet
//! hrefs as strings) and the structural stages (interned `u32` token ids).
//! The first half of telling a page's shared chrome from its page-specific
//! content; `split_tokens_by_frequency` makes the call per token.
//!
//! The corpus must be a homogeneous page collection (one site, or one
//! section of a multi-template site): a federation of independently
//! templated sub-sections has no token common to most pages, and
//! frequency-based chrome detection finds nothing. Splitting the pages first
//! is the caller's job; nothing here can detect a mixed corpus.

use std::hash::Hash;

use rustc_hash::FxHashMap;

/// How many pages (out of `page_count`) contain each token.
///
/// `page_count` travels with the counts so the two cannot be passed out of
/// sync: a caller re-slicing the page list between counting and using the
/// result would otherwise get a silently wrong cutoff.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentFrequency<T: Eq + Hash> {
	/// Pages containing the token; a token absent from the map occurs on none.
	/// Iteration order is unspecified and never observable in a result: the
	/// split only looks tokens up.
	pub document_frequency: FxHashMap<T, usize>,
	/// How many token sets were counted, empty ones included.
	pub page_count: usize,
}

/// Counts, for each token, how many of `token_sets` contain it.
///
/// Each set must hold distinct tokens (it is a set per page): a token listed
/// twice within one set would count twice.
///
/// ```text
/// compute_document_frequency([["a", "b"], ["b", "c"]])
/// // page_count 2; "b" occurs on 2 pages, "a" and "c" on 1.
/// ```
pub fn compute_document_frequency<T, S, I>(token_sets: I) -> DocumentFrequency<T>
where
	T: Eq + Hash,
	S: IntoIterator<Item = T>,
	I: IntoIterator<Item = S>,
{
	let mut document_frequency: FxHashMap<T, usize> = FxHashMap::default();
	let mut page_count = 0;
	for tokens in token_sets {
		page_count += 1;
		for token in tokens {
			*document_frequency.entry(token).or_insert(0) += 1;
		}
	}
	DocumentFrequency {
		document_frequency,
		page_count,
	}
}

#[cfg(test)]
mod tests {
	use super::compute_document_frequency;

	#[test]
	fn empty_input_has_no_counts_and_no_pages() {
		let result = compute_document_frequency(Vec::<Vec<&str>>::new());
		assert!(result.document_frequency.is_empty());
		assert_eq!(result.page_count, 0);
	}

	#[test]
	fn page_count_is_the_number_of_token_sets() {
		let result = compute_document_frequency([vec!["a"], vec!["b"], vec!["c"]]);
		assert_eq!(result.page_count, 3);
	}

	#[test]
	fn a_token_in_every_set_counts_the_set_count() {
		let result = compute_document_frequency([
			vec!["body>header>a"],
			vec!["body>header>a"],
			vec!["body>header>a"],
		]);
		assert_eq!(result.document_frequency.len(), 1);
		assert_eq!(result.document_frequency["body>header>a"], 3);
		assert_eq!(result.page_count, 3);
	}

	#[test]
	fn a_token_in_one_set_counts_one() {
		let result = compute_document_frequency([vec!["body>main>p"], vec!["body>footer>span"]]);
		assert_eq!(result.document_frequency["body>main>p"], 1);
		assert_eq!(result.document_frequency["body>footer>span"], 1);
	}

	#[test]
	fn counts_distinct_tokens_independently_across_overlapping_sets() {
		let result = compute_document_frequency([vec!["a", "b"], vec!["b", "c"], vec!["b"]]);
		assert_eq!(result.document_frequency["a"], 1);
		assert_eq!(result.document_frequency["b"], 3);
		assert_eq!(result.document_frequency["c"], 1);
	}

	#[test]
	fn an_empty_set_adds_no_entries_but_counts_as_a_page() {
		let result = compute_document_frequency([Vec::<&str>::new()]);
		assert!(result.document_frequency.is_empty());
		assert_eq!(result.page_count, 1);
	}

	#[test]
	fn counts_interned_integer_tokens() {
		let result = compute_document_frequency([vec![1_u32, 2], vec![2_u32]]);
		assert_eq!(result.document_frequency[&1], 1);
		assert_eq!(result.document_frequency[&2], 2);
		assert_eq!(result.page_count, 2);
	}
}
