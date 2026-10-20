use crate::element::Element;
use crate::matches_attribute_test::matches_attribute_test;
use crate::matches_nth::matches_nth;
use crate::selector_plan::{Compound, Conditions};

/// Whether `element` meets every condition of `conditions`: the tag, each
/// position test (against the element's sibling counts) and each attribute.
fn meets(conditions: &Conditions, element: &mut Element) -> bool {
	if let Some(tag) = &conditions.tag
		&& !tag.as_bytes().eq_ignore_ascii_case(element.name())
	{
		return false;
	}
	for nth in &conditions.nth {
		let position = if nth.of_type {
			element.type_index
		} else {
			element.child_index
		};
		if !matches_nth(position, nth.a, nth.b) {
			return false;
		}
	}
	if !conditions.attributes.is_empty() {
		let attributes = element.attributes();
		for test in &conditions.attributes {
			if !matches_attribute_test(test, attributes) {
				return false;
			}
		}
	}
	true
}

/// Whether `element` satisfies a compound selector: all of its conditions,
/// and none of the compounds inside its `:not(...)`.
#[must_use]
pub fn matches_compound(compound: &Compound, element: &mut Element) -> bool {
	meets(&compound.conditions, element)
		&& !compound
			.negations
			.iter()
			.any(|negation| meets(negation, element))
}

#[cfg(test)]
mod tests {
	use super::matches_compound;
	use crate::element::Element;
	use crate::selector_plan::{AttributeOperator, AttributeTest, Compound, Conditions, NthTest};

	fn tagged(tag: &str) -> Conditions {
		Conditions {
			tag: Some(tag.to_owned()),
			..Conditions::default()
		}
	}

	fn with_attribute(mut conditions: Conditions, name: &str) -> Conditions {
		conditions.attributes.push(AttributeTest {
			name: name.to_owned(),
			operator: AttributeOperator::Exists,
			value: String::new(),
			ignore_case: false,
		});
		conditions
	}

	#[test]
	fn needs_every_condition() {
		let compound = Compound {
			conditions: with_attribute(tagged("img"), "alt"),
			negations: vec![],
		};
		let mut element = Element::new();
		element.set(b"IMG", b" src=\"a\" alt=\"b\"");
		assert!(matches_compound(&compound, &mut element));
		element.set(b"IMG", b" src=\"a\"");
		assert!(!matches_compound(&compound, &mut element));
		element.set(b"a", b" alt=\"b\"");
		assert!(!matches_compound(&compound, &mut element));
	}

	#[test]
	fn an_element_with_no_tag_condition_matches_any_name() {
		let compound = Compound::default();
		let mut element = Element::new();
		element.set(b"svg:rect", b"");
		assert!(matches_compound(&compound, &mut element));
	}

	#[test]
	fn rejects_an_element_that_meets_a_negation() {
		let compound = Compound {
			conditions: tagged("a"),
			negations: vec![with_attribute(Conditions::default(), "download")],
		};
		let mut element = Element::new();
		element.set(b"a", b" href=\"/\"");
		assert!(matches_compound(&compound, &mut element));
		element.set(b"a", b" download");
		assert!(!matches_compound(&compound, &mut element));
	}

	#[test]
	fn tests_the_position_that_matches_the_kind() {
		let compound = Compound {
			conditions: Conditions {
				nth: vec![NthTest {
					of_type: true,
					a: 0.0,
					b: 2.0,
				}],
				..Conditions::default()
			},
			negations: vec![],
		};
		let mut element = Element::new();
		element.set(b"p", b"");
		element.child_index = 5;
		element.type_index = 2;
		assert!(matches_compound(&compound, &mut element));
		element.type_index = 3;
		assert!(!matches_compound(&compound, &mut element));
	}

	#[test]
	fn the_tag_name_must_match_whole() {
		let compound = Compound {
			conditions: tagged("art"),
			negations: vec![],
		};
		let mut element = Element::new();
		for (name, expected) in [
			(&b"art"[..], true),
			(b"ART", true),
			(b"article", false),
			(b"a", false),
		] {
			element.set(name, b"");
			assert_eq!(matches_compound(&compound, &mut element), expected);
		}
	}

	#[test]
	fn not_star_matches_nothing() {
		let compound = Compound {
			conditions: Conditions::default(),
			negations: vec![Conditions::default()],
		};
		let mut element = Element::new();
		element.set(b"a", b"");
		assert!(!matches_compound(&compound, &mut element));
	}

	#[test]
	fn an_attribute_test_that_can_never_match_fails_inside_and_succeeds_inside_not() {
		let never = AttributeTest {
			name: "x".to_owned(),
			operator: AttributeOperator::Prefix,
			value: String::new(),
			ignore_case: false,
		};
		let positive = Compound {
			conditions: Conditions {
				attributes: vec![never.clone()],
				..Conditions::default()
			},
			negations: vec![],
		};
		let negated = Compound {
			conditions: Conditions::default(),
			negations: vec![Conditions {
				attributes: vec![never],
				..Conditions::default()
			}],
		};
		let mut element = Element::new();
		element.set(b"a", b" x=\"v\"");
		assert!(!matches_compound(&positive, &mut element));
		assert!(matches_compound(&negated, &mut element));
	}

	#[test]
	fn every_attribute_test_must_hold() {
		let compound = Compound {
			conditions: with_attribute(with_attribute(Conditions::default(), "href"), "title"),
			negations: vec![],
		};
		let mut element = Element::new();
		element.set(b"a", b" href=\"/x\"");
		assert!(!matches_compound(&compound, &mut element));
		element.set(b"a", b" href=\"/x\" title=\"t\"");
		assert!(matches_compound(&compound, &mut element));
	}
}
