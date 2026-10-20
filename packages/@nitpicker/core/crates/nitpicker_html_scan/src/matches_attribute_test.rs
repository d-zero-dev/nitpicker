use std::borrow::Cow;

use crate::ascii::is_html_space;
use crate::decode_serialized_attribute_value::decode_serialized_attribute_value;
use crate::selector_plan::{AttributeOperator, AttributeTest};
use crate::start_tag_attributes::StartTagAttribute;

/// Lower-cases ASCII letters only, the way selectors fold attribute values
/// for the `i` flag.
fn fold(bytes: &[u8], ignore_case: bool) -> Cow<'_, [u8]> {
	if ignore_case && bytes.iter().any(u8::is_ascii_uppercase) {
		Cow::Owned(bytes.to_ascii_lowercase())
	} else {
		Cow::Borrowed(bytes)
	}
}

/// Evaluates one attribute selector against a start tag's attributes. The
/// first attribute of the name is the one that counts. An empty value never
/// matches `^=`, `$=`, `*=` or `~=`, and a `~=` value containing whitespace
/// never matches, as in CSS.
#[must_use]
pub fn matches_attribute_test(test: &AttributeTest, attributes: &[StartTagAttribute]) -> bool {
	let Some(attribute) = attributes
		.iter()
		.find(|attribute| attribute.name.eq_ignore_ascii_case(test.name.as_bytes()))
	else {
		return false;
	};
	if test.operator == AttributeOperator::Exists {
		return true;
	}
	let expected = test.value.as_bytes();
	if expected.is_empty()
		&& matches!(
			test.operator,
			AttributeOperator::Prefix
				| AttributeOperator::Suffix
				| AttributeOperator::Substring
				| AttributeOperator::Includes
		) {
		return false;
	}
	if test.operator == AttributeOperator::Includes && expected.iter().any(|&b| is_html_space(b)) {
		return false;
	}
	let decoded = decode_serialized_attribute_value(attribute.value);
	let actual = fold(&decoded, test.ignore_case);
	let expected = fold(expected, test.ignore_case);
	let (actual, expected) = (actual.as_ref(), expected.as_ref());
	match test.operator {
		AttributeOperator::Exists => true,
		AttributeOperator::Equals => actual == expected,
		AttributeOperator::Includes => actual
			.split(|&byte| is_html_space(byte))
			.any(|token| token == expected),
		AttributeOperator::Dash => {
			actual == expected
				|| (actual.starts_with(expected) && actual.get(expected.len()) == Some(&b'-'))
		}
		AttributeOperator::Prefix => actual.starts_with(expected),
		AttributeOperator::Suffix => actual.ends_with(expected),
		AttributeOperator::Substring => actual
			.windows(expected.len())
			.any(|window| window == expected),
	}
}

#[cfg(test)]
mod tests {
	use super::matches_attribute_test;
	use crate::selector_plan::{AttributeOperator, AttributeTest};
	use crate::start_tag_attributes::StartTagAttribute;

	fn test(
		name: &str,
		operator: AttributeOperator,
		value: &str,
		ignore_case: bool,
	) -> AttributeTest {
		AttributeTest {
			name: name.to_owned(),
			operator,
			value: value.to_owned(),
			ignore_case,
		}
	}

	fn attribute<'a>(name: &'a str, value: &'a str) -> StartTagAttribute<'a> {
		StartTagAttribute {
			name: name.as_bytes(),
			value: value.as_bytes(),
		}
	}

	fn holds(test: &AttributeTest, attributes: &[StartTagAttribute]) -> bool {
		matches_attribute_test(test, attributes)
	}

	#[test]
	fn exists_needs_the_attribute_only() {
		let attrs = [attribute("alt", "")];
		assert!(holds(
			&test("alt", AttributeOperator::Exists, "", false),
			&attrs
		));
		assert!(!holds(
			&test("title", AttributeOperator::Exists, "", false),
			&attrs
		));
	}

	#[test]
	fn names_ignore_ascii_case_and_the_first_attribute_wins() {
		let attrs = [attribute("HREF", "/a"), attribute("href", "/b")];
		assert!(holds(
			&test("href", AttributeOperator::Equals, "/a", false),
			&attrs
		));
		assert!(!holds(
			&test("href", AttributeOperator::Equals, "/b", false),
			&attrs
		));
	}

	#[test]
	fn compares_each_operator() {
		let attrs = [attribute("v", "en-US foo")];
		assert!(holds(
			&test("v", AttributeOperator::Equals, "en-US foo", false),
			&attrs
		));
		assert!(holds(
			&test("v", AttributeOperator::Includes, "foo", false),
			&attrs
		));
		assert!(!holds(
			&test("v", AttributeOperator::Includes, "en", false),
			&attrs
		));
		assert!(holds(
			&test("v", AttributeOperator::Dash, "en", false),
			&attrs
		));
		assert!(!holds(
			&test("v", AttributeOperator::Dash, "e", false),
			&attrs
		));
		assert!(holds(
			&test("v", AttributeOperator::Prefix, "en-", false),
			&attrs
		));
		assert!(holds(
			&test("v", AttributeOperator::Suffix, "foo", false),
			&attrs
		));
		assert!(holds(
			&test("v", AttributeOperator::Substring, "US f", false),
			&attrs
		));
	}

	#[test]
	fn dash_matches_the_whole_value() {
		assert!(holds(
			&test("lang", AttributeOperator::Dash, "ja", false),
			&[attribute("lang", "ja")]
		));
	}

	#[test]
	fn an_empty_value_never_matches_prefix_suffix_substring_or_includes() {
		let attrs = [attribute("a", "x")];
		for operator in [
			AttributeOperator::Prefix,
			AttributeOperator::Suffix,
			AttributeOperator::Substring,
			AttributeOperator::Includes,
		] {
			assert!(!holds(&test("a", operator, "", false), &attrs));
		}
		assert!(holds(
			&test("a", AttributeOperator::Equals, "", false),
			&[attribute("a", "")]
		));
	}

	#[test]
	fn an_includes_value_with_whitespace_never_matches() {
		assert!(!holds(
			&test("a", AttributeOperator::Includes, "x y", false),
			&[attribute("a", "x y")]
		));
	}

	#[test]
	fn the_includes_separator_is_ascii_whitespace_only() {
		assert!(!holds(
			&test("a", AttributeOperator::Includes, "y", false),
			&[attribute("a", "x\u{a0}y")]
		));
	}

	#[test]
	fn decodes_entities_before_comparing() {
		assert!(holds(
			&test("a", AttributeOperator::Equals, "a&b\"c", false),
			&[attribute("a", "a&amp;b&quot;c")]
		));
		assert!(!holds(
			&test("a", AttributeOperator::Substring, "amp;", false),
			&[attribute("a", "a&amp;b")]
		));
	}

	#[test]
	fn the_i_flag_folds_ascii_letters_only() {
		let attrs = [attribute("v", "ABC\u{212a}")];
		assert!(holds(
			&test("v", AttributeOperator::Equals, "abc\u{212a}", true),
			&attrs
		));
		assert!(!holds(
			&test("v", AttributeOperator::Equals, "abcK", true),
			&attrs
		));
		assert!(!holds(
			&test("v", AttributeOperator::Equals, "abc\u{212a}", false),
			&attrs
		));
	}

	#[test]
	fn evaluates_each_operator_against_present_and_absent_values() {
		use AttributeOperator::{Dash, Equals, Exists, Includes, Prefix, Substring, Suffix};
		let cases: [(AttributeOperator, &str, Option<&str>, bool); 25] = [
			(Exists, "", Some(""), true),
			(Exists, "", None, false),
			(Equals, "a", Some("a"), true),
			(Equals, "a", Some("ab"), false),
			(Equals, "", Some(""), true),
			(Equals, "a", None, false),
			(Includes, "b", Some("a b c"), true),
			(Includes, "b", Some("a bc"), false),
			(Includes, "b", Some("a\tb"), true),
			(Includes, "a b", Some("a b"), false),
			(Includes, "", Some("a"), false),
			(Dash, "en", Some("en"), true),
			(Dash, "en", Some("en-US"), true),
			(Dash, "en", Some("english"), false),
			(Dash, "", Some(""), true),
			(Dash, "", Some("-x"), true),
			(Prefix, "ab", Some("abc"), true),
			(Prefix, "bc", Some("abc"), false),
			(Prefix, "", Some("abc"), false),
			(Suffix, "bc", Some("abc"), true),
			(Suffix, "ab", Some("abc"), false),
			(Suffix, "", Some("abc"), false),
			(Substring, "b", Some("abc"), true),
			(Substring, "d", Some("abc"), false),
			(Substring, "", Some("abc"), false),
		];
		for (operator, value, actual, expected) in cases {
			let attributes: Vec<StartTagAttribute> = actual
				.map(|actual| attribute("x", actual))
				.into_iter()
				.collect();
			assert_eq!(
				holds(&test("x", operator, value, false), &attributes),
				expected,
				"{operator:?} {value:?} against {actual:?}"
			);
		}
	}

	#[test]
	fn matches_the_decoded_value_not_the_stored_text() {
		use AttributeOperator::{Equals, Includes, Prefix, Substring, Suffix};
		let amp = [attribute("x", "&amp;")];
		assert!(!holds(&test("x", Substring, "amp", false), &amp));
		assert!(holds(&test("x", Substring, "&", false), &amp));
		assert!(!holds(&test("x", Suffix, ";", false), &amp));
		assert!(holds(&test("x", Suffix, "&", false), &amp));
		assert!(holds(
			&test("x", Prefix, "&", false),
			&[attribute("x", "&amp;z")]
		));
		assert!(!holds(
			&test("x", Prefix, "amp", false),
			&[attribute("x", "&amp;z")]
		));
		assert!(holds(
			&test("x", Substring, "amp", false),
			&[attribute("x", "a&amp;amp;")]
		));
		assert!(holds(
			&test("x", Includes, "&", false),
			&[attribute("x", "x &amp; y")]
		));
		assert!(holds(
			&test("x", Equals, "&amp;", false),
			&[attribute("x", "&amp;amp;")]
		));
		assert!(!holds(&test("x", Equals, "&amp;", false), &amp));
		assert!(holds(
			&test("x", Equals, "a\u{a0}b", false),
			&[attribute("x", "a&nbsp;b")]
		));
		assert!(holds(
			&test("x", Equals, "say \"hi\"", false),
			&[attribute("x", "say &quot;hi&quot;")]
		));
	}

	#[test]
	fn does_not_fold_non_ascii_letters() {
		assert!(!holds(
			&test("x", AttributeOperator::Equals, "\u{c9}", true),
			&[attribute("x", "\u{e9}")]
		));
	}
}
