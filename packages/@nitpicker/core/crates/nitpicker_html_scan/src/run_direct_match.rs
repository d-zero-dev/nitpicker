use crate::element::Element;
use crate::matches_compound::matches_compound;
use crate::selector_plan::Alternative;
use crate::tag_tokenizer::{TagEvent, TagTokenizer};

/// What reading a document's start tags told about the direct alternatives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirectMatch {
	/// A start tag satisfies one of the alternatives.
	Matched,
	/// Every start tag was read and none does.
	Unmatched,
	/// A `<template` start tag was reached first: its content is a separate
	/// fragment the open-element stack has to skip, so the whole document
	/// goes to the stack.
	NeedsStack,
}

/// Decides from start tags alone whether an element matches one of
/// `alternatives`, each a single compound with no position test.
///
/// The document is read left to right and a start tag is tested as soon as
/// it is read, so an answer reached before the first `<template` is exact:
/// nothing before it can be inside a template. End tags are ignored — a
/// compound does not look at the tree.
#[must_use]
pub fn run_direct_match(html: &[u8], alternatives: &[&Alternative]) -> DirectMatch {
	let mut tokenizer = TagTokenizer::new(html);
	let mut element = Element::new();
	while let Some(event) = tokenizer.next_event() {
		let TagEvent::Open {
			name, attributes, ..
		} = event
		else {
			continue;
		};
		element.set(name, attributes);
		if alternatives
			.iter()
			.any(|alternative| matches_compound(&alternative.compounds[0], &mut element))
		{
			return DirectMatch::Matched;
		}
		if name.eq_ignore_ascii_case(b"template") {
			return DirectMatch::NeedsStack;
		}
	}
	DirectMatch::Unmatched
}

#[cfg(test)]
mod tests {
	use super::{DirectMatch, run_direct_match};
	use crate::selector_plan::{
		Alternative, AttributeOperator, AttributeTest, Compound, Conditions,
	};

	fn alternative(tag: Option<&str>, attribute: Option<&str>) -> Alternative {
		let mut conditions = Conditions {
			tag: tag.map(ToOwned::to_owned),
			..Conditions::default()
		};
		if let Some(name) = attribute {
			conditions.attributes.push(AttributeTest {
				name: name.to_owned(),
				operator: AttributeOperator::Exists,
				value: String::new(),
				ignore_case: false,
			});
		}
		Alternative {
			compounds: vec![Compound {
				conditions,
				negations: vec![],
			}],
			combinators: vec![],
			prefilter_literals: None,
			direct: true,
		}
	}

	fn run(html: &str, alternatives: &[Alternative]) -> DirectMatch {
		let refs: Vec<&Alternative> = alternatives.iter().collect();
		run_direct_match(html.as_bytes(), &refs)
	}

	#[test]
	fn matches_the_first_start_tag_that_fits() {
		let img_alt = [alternative(Some("img"), Some("alt"))];
		assert_eq!(run("<p><img alt=\"\"></p>", &img_alt), DirectMatch::Matched);
		assert_eq!(run("<p><img></p>", &img_alt), DirectMatch::Unmatched);
	}

	#[test]
	fn any_alternative_may_fit() {
		let list = [alternative(Some("b"), None), alternative(Some("i"), None)];
		assert_eq!(run("<p><i></i></p>", &list), DirectMatch::Matched);
	}

	#[test]
	fn does_not_read_inside_comments_or_raw_text() {
		let img = [alternative(Some("img"), None)];
		assert_eq!(
			run("<!-- <img> --><script>'<img>'</script>", &img),
			DirectMatch::Unmatched
		);
	}

	#[test]
	fn a_raw_text_start_tag_can_match_itself() {
		let script_src = [alternative(Some("script"), Some("src"))];
		assert_eq!(
			run("<script src=\"a\">x</script>", &script_src),
			DirectMatch::Matched
		);
	}

	#[test]
	fn ignores_a_less_than_sign_inside_a_quoted_value() {
		let img = [alternative(Some("img"), None)];
		assert_eq!(
			run("<a title=\"<img>\">x</a>", &img),
			DirectMatch::Unmatched
		);
	}

	#[test]
	fn stops_at_the_first_template_start_tag() {
		let img = [alternative(Some("img"), None)];
		assert_eq!(
			run("<p><template><img></template>", &img),
			DirectMatch::NeedsStack
		);
	}

	#[test]
	fn a_match_before_a_template_is_final() {
		let img = [alternative(Some("img"), None)];
		assert_eq!(run("<img><template>", &img), DirectMatch::Matched);
	}

	#[test]
	fn a_template_start_tag_can_match_itself() {
		let template = [alternative(Some("template"), None)];
		assert_eq!(run("<template><i>", &template), DirectMatch::Matched);
	}

	#[test]
	fn reads_markup_the_way_the_interpretation_rules_say() {
		let img = [alternative(Some("img"), None)];
		let cases = [
			("<p><img></p>", DirectMatch::Matched),
			("<p></p>", DirectMatch::Unmatched),
			("", DirectMatch::Unmatched),
			("<!-- <img> --><p></p>", DirectMatch::Unmatched),
			("<!-- <img>", DirectMatch::Unmatched),
			("<![CDATA[ <img> ]]><p>", DirectMatch::Unmatched),
			("<!DOCTYPE html><p>", DirectMatch::Unmatched),
			("<script>\"<img>\"</script><p>", DirectMatch::Unmatched),
			("<script>\"<img>\"</script><img>", DirectMatch::Matched),
			("<script>\"<img>\"", DirectMatch::Unmatched),
			("<noscript><img></noscript>", DirectMatch::Unmatched),
			("<plaintext><img>", DirectMatch::Unmatched),
			("<style>a{}</style><img>", DirectMatch::Matched),
			("<template><img></template>", DirectMatch::NeedsStack),
			("<img><template><img></template>", DirectMatch::Matched),
			("<p><TEMPLATE></TEMPLATE>", DirectMatch::NeedsStack),
			("<a title=\"<img>\"></a>", DirectMatch::Unmatched),
			("<a title=\"<template>\"></a>", DirectMatch::Unmatched),
			("<a title=\"x > <img>\"></a><img>", DirectMatch::Matched),
		];
		for (html, expected) in cases {
			assert_eq!(run(html, &img), expected, "{html}");
		}
	}

	#[test]
	fn does_not_rescan_the_rest_of_the_document_for_every_unterminated_comment() {
		let img = [alternative(Some("img"), None)];
		let html = "<!-- ".repeat(20_000) + &"x".repeat(1_000_000);
		assert_eq!(run(&html, &img), DirectMatch::Unmatched);
	}
}
