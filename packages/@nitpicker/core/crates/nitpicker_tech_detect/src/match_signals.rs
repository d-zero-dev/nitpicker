use std::sync::LazyLock;

use aho_corasick::AhoCorasick;
use regex::bytes::Regex;

use crate::definitions::{SIGNAL_DEFINITIONS, SignalDefinition};
use crate::truncate_evidence::truncate_evidence;

/// One definition that matched: its fields and the evidence cut from the
/// first match.
#[derive(Debug, PartialEq, Eq)]
pub struct TechnologySignal {
	pub technology: &'static str,
	pub signal_type: &'static str,
	/// The first match, cut by [`truncate_evidence`].
	pub evidence: String,
	pub weight: u32,
	pub category: &'static str,
}

/// Every definition's required literal, pattern index for index with
/// [`SIGNAL_DEFINITIONS`], matched ASCII-case-insensitively — a superset
/// of each pattern's own case rule, which the pattern itself then applies.
static LITERALS: LazyLock<AhoCorasick> = LazyLock::new(|| {
	AhoCorasick::builder()
		.ascii_case_insensitive(true)
		.build(
			SIGNAL_DEFINITIONS
				.iter()
				.map(|definition| definition.required_literal),
		)
		.expect("the required literals build an automaton")
});

/// Every definition's pattern, index for index with [`SIGNAL_DEFINITIONS`].
static PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
	SIGNAL_DEFINITIONS
		.iter()
		.map(|definition| {
			Regex::new(definition.pattern)
				.expect("every signal pattern is a valid regular expression")
		})
		.collect()
});

/// Matches every definition against a page's HTML, returning one signal per
/// definition that occurs, in definition order.
///
/// One pass of [`LITERALS`] marks the definitions whose literal occurs;
/// only those patterns run, to confirm a match and locate the first one
/// (leftmost-first, as JS `exec` finds it) for the evidence. Pages without
/// any fingerprint — most pages — are read once. A `RegexSet` over the
/// patterns was measured no faster than running them one by one, because
/// each pattern already skips ahead on its own literals; the literal pass
/// is about twice as fast as either. The pass reports overlapping hits:
/// occurrences of two literals can share bytes (`/_next/_astro/`), and a
/// scan that resumed after each hit would miss the second.
#[must_use]
pub fn match_html_signals(html: &[u8]) -> Vec<TechnologySignal> {
	let mut candidates = vec![false; SIGNAL_DEFINITIONS.len()];
	for hit in LITERALS.find_overlapping_iter(html) {
		candidates[hit.pattern().as_usize()] = true;
	}
	candidates
		.iter()
		.enumerate()
		.filter(|&(_, &candidate)| candidate)
		.filter_map(|(index, _)| signal_from_first_match(index, html))
		.collect()
}

/// Matches the `js-license-comment` definitions against a JS resource's
/// leading bytes, returning the first that occurs.
///
/// No literal pass: the JS resource scan reads a few kilobytes and tests
/// the license-banner definitions only.
#[must_use]
pub fn match_js_license_comment_signal(script: &[u8]) -> Option<TechnologySignal> {
	SIGNAL_DEFINITIONS
		.iter()
		.enumerate()
		.filter(|(_, definition)| definition.signal_type == "js-license-comment")
		.find_map(|(index, _)| signal_from_first_match(index, script))
}

fn signal_from_first_match(index: usize, input: &[u8]) -> Option<TechnologySignal> {
	let definition: &SignalDefinition = &SIGNAL_DEFINITIONS[index];
	PATTERNS[index].find(input).map(|matched| TechnologySignal {
		technology: definition.technology,
		signal_type: definition.signal_type,
		evidence: truncate_evidence(matched.as_bytes()),
		weight: definition.weight,
		category: definition.category,
	})
}

#[cfg(test)]
mod tests {
	use super::{match_html_signals, match_js_license_comment_signal};

	fn technologies(html: &str) -> Vec<(&'static str, &'static str)> {
		match_html_signals(html.as_bytes())
			.into_iter()
			.map(|signal| (signal.technology, signal.signal_type))
			.collect()
	}

	#[test]
	fn reports_signals_in_definition_order() {
		assert_eq!(
			technologies(
				r#"<script src="/_next/a.js"></script><div id="__next"></div><script id="__NEXT_DATA__"></script>"#
			),
			[
				("Next.js", "html-marker"),
				("Next.js", "html-marker"),
				("Next.js", "url-pattern")
			]
		);
	}

	#[test]
	fn reports_definitions_whose_literals_share_bytes() {
		assert_eq!(
			technologies("/_next/_astro/"),
			[("Next.js", "url-pattern"), ("Astro", "url-pattern")]
		);
	}

	#[test]
	fn returns_nothing_for_a_page_without_fingerprints() {
		assert!(match_html_signals(b"<html><body>plain</body></html>").is_empty());
	}

	#[test]
	fn returns_nothing_when_a_literal_occurs_without_its_pattern() {
		assert!(technologies(r#"<p>id="__next"</p>"#).is_empty());
	}

	#[test]
	fn takes_the_evidence_from_the_first_match() {
		let signals = match_html_signals(b"<p data-v-aaaaaa1></p><p data-v-bbbbbb2></p>");
		assert_eq!(signals[0].evidence, " data-v-aaaaaa1");
		assert_eq!(signals[0].weight, 40);
		assert_eq!(signals[0].category, "JavaScript frameworks");
	}

	#[test]
	fn treats_non_ascii_js_spaces_as_spaces() {
		assert_eq!(
			technologies("<div\u{FEFF}id=\"app\">"),
			[("Vue", "weak-marker")]
		);
		assert_eq!(
			technologies("<div\u{3000}id=\"app\">"),
			[("Vue", "weak-marker")]
		);
		assert!(technologies("<div\u{85}id=\"app\">").is_empty());
	}

	#[test]
	fn folds_only_ascii_letters() {
		assert_eq!(technologies("<ASTRO-ISLAND>"), [("Astro", "html-marker")]);
		// U+212A (Kelvin sign) folds to `k` in Unicode mode; JS without `u` does not.
		assert!(technologies(" data-v-\u{212A}1b2c3d").is_empty());
	}

	#[test]
	fn keeps_url_patterns_case_sensitive() {
		assert!(technologies("/_NEXT/").is_empty());
	}

	#[test]
	fn requires_an_ascii_word_boundary_after_a_scoped_attribute() {
		assert!(technologies(" data-v-abcdef12345").is_empty());
		assert_eq!(technologies(" data-v-abcdef12-x"), [("Vue", "scoped-attr")]);
	}

	#[test]
	fn finds_a_license_banner_in_a_script() {
		let signal = match_js_license_comment_signal(b"/*!\n * Vue.js v3.4.0\n */")
			.expect("the banner matches");
		assert_eq!(signal.technology, "Vue");
		assert_eq!(signal.evidence, "/*!\n * Vue.js v3");
	}

	#[test]
	fn ignores_html_markers_in_a_script() {
		assert_eq!(match_js_license_comment_signal(br#"<div id="app">"#), None);
	}
}
