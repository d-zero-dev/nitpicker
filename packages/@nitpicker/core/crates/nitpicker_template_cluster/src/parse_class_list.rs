use nitpicker_html_parser::to_lower_case_js;

use crate::is_noise_class::is_noise_class;
use crate::js_string::{compare_utf16, js_decode_uri, js_split_whitespace, js_trim};

/// `alphabeticalComparator`'s key: lower-cased, then `decodeURI`d when that
/// does not throw.
fn sort_key(name: &str) -> String {
	let lowered = to_lower_case_js(name);
	js_decode_uri(&lowered).unwrap_or_else(|| lowered.into_owned())
}

/// Splits a (decoded) `class` attribute value into its class names:
/// deduplicated in first-occurrence order, auto-generated names removed
/// (see `is_noise_class`), then sorted case-insensitively — the order the
/// names appear in in a path segment (`.alpha.Beta`). The sort is stable,
/// so names whose keys tie keep their order.
#[must_use]
pub fn parse_class_list(class_attribute: &str) -> Vec<&str> {
	let mut names: Vec<&str> = Vec::new();
	for name in js_split_whitespace(js_trim(class_attribute)) {
		if !names.contains(&name) {
			names.push(name);
		}
	}
	names.retain(|name| !is_noise_class(name));
	let mut keyed: Vec<(String, &str)> = names
		.into_iter()
		.map(|name| (sort_key(name), name))
		.collect();
	keyed.sort_by(|(a, _), (b, _)| compare_utf16(a, b));
	keyed.into_iter().map(|(_, name)| name).collect()
}

#[cfg(test)]
mod tests {
	use super::parse_class_list;

	#[test]
	fn dedupes_filters_noise_and_sorts_ignoring_case() {
		assert_eq!(
			parse_class_list("  Beta alpha\u{3000}beta alpha _a1b2c3 "),
			vec!["alpha", "Beta", "beta"]
		);
	}

	#[test]
	fn sorts_by_the_uri_decoded_key() {
		// Lowering comes first, so "%41" keys as the decoded "A" (sorting before
		// "b"); the undecodable "%zz" keys as itself and sorts first.
		assert_eq!(parse_class_list("b %41 %zz"), vec!["%zz", "%41", "b"]);
	}

	#[test]
	fn returns_nothing_for_an_empty_attribute() {
		assert!(parse_class_list("   ").is_empty());
		assert!(parse_class_list("").is_empty());
	}

	#[test]
	fn sorts_case_insensitively() {
		assert_eq!(
			parse_class_list("zeta alpha Beta"),
			vec!["alpha", "Beta", "zeta"]
		);
	}

	#[test]
	fn deduplicates_repeated_class_names() {
		assert_eq!(parse_class_list("foo foo bar"), vec!["bar", "foo"]);
	}

	#[test]
	fn filters_noise_classes() {
		assert_eq!(
			parse_class_list("card sc-bdVaJa featured"),
			vec!["card", "featured"]
		);
	}

	#[test]
	fn treats_an_all_noise_attribute_as_empty() {
		assert!(parse_class_list("sc-bdVaJa").is_empty());
	}
}
