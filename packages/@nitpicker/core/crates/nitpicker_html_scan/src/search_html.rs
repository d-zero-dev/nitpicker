use regex::Regex;

use crate::build_snippet::build_snippet;

/// What a search found in one document.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SearchOutcome {
	/// Non-overlapping matches, counted as `Regex::find_iter` walks them.
	pub match_count: u32,
	/// The window around the first match; empty when there is none.
	pub snippet: String,
}

/// Counts the matches of `regex` in `text` and cuts a snippet of
/// `snippet_length` characters around the first.
///
/// The count saturates at `u32::MAX`.
#[must_use]
pub fn search_html(regex: &Regex, text: &str, snippet_length: usize) -> SearchOutcome {
	let mut matches = regex.find_iter(text);
	let Some(first) = matches.next() else {
		return SearchOutcome::default();
	};
	let rest = u32::try_from(matches.count()).unwrap_or(u32::MAX);
	SearchOutcome {
		match_count: rest.saturating_add(1),
		snippet: build_snippet(text, first.start(), first.end(), snippet_length),
	}
}

#[cfg(test)]
mod tests {
	use regex::Regex;

	use super::search_html;
	use crate::search_pattern::{RegexFlags, SearchKind, SearchPattern, compile_search_pattern};

	fn compile(source: &str, ignore_case: bool) -> Regex {
		compile_search_pattern(&SearchPattern {
			source: source.to_owned(),
			kind: SearchKind::Regex(RegexFlags {
				ignore_case,
				..RegexFlags::default()
			}),
		})
		.unwrap()
	}

	#[test]
	fn reports_no_match_as_zero_and_an_empty_snippet() {
		let outcome = search_html(&compile("x", false), "abc", 10);
		assert_eq!(outcome.match_count, 0);
		assert_eq!(outcome.snippet, "");
	}

	#[test]
	fn counts_non_overlapping_matches() {
		assert_eq!(
			search_html(&compile("aa", false), "aaaaa", 10).match_count,
			2
		);
	}

	#[test]
	fn a_dot_matches_an_emoji_once() {
		assert_eq!(search_html(&compile("^.$", false), "😀", 10).match_count, 1);
	}

	#[test]
	fn d_matches_unicode_digits() {
		assert_eq!(
			search_html(&compile(r"\d+", false), "x٣٤y", 10).match_count,
			1
		);
	}

	#[test]
	fn a_pattern_that_cannot_match_empty_can_still_match_empty_in_a_document() {
		// `\b` matches the empty string at every word boundary of "ab cd".
		assert_eq!(
			search_html(&compile(r"\b", false), "ab cd", 10).match_count,
			4
		);
	}

	#[test]
	fn takes_the_snippet_from_the_first_match() {
		let outcome = search_html(&compile("needle", true), "hay NEEDLE hay needle", 12);
		assert_eq!(outcome.match_count, 2);
		// The match is characters 4..10, so its middle is 7 and the window starts at 1.
		assert_eq!(outcome.snippet, "ay NEEDLE ha");
	}
}
