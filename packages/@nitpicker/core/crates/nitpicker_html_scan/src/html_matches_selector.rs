use crate::passes_ordered_prefilter::passes_ordered_prefilter;
use crate::run_direct_match::{DirectMatch, run_direct_match};
use crate::run_selector_state_machine::{IndexNeeds, run_selector_state_machine};
use crate::selector_plan::{Alternative, SelectorPlan};

/// The verdict on one document and which stages produced it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HtmlMatchOutcome {
	/// Whether an element of the document matches the selector list.
	pub matched: bool,
	/// `true` when the ordered-literal prefilter rejected the document and
	/// its markup was never read.
	pub prefiltered: bool,
	/// `true` when the open-element stack ran over the document.
	pub tokenized: bool,
	/// How many elements the stack tested (zero when it did not run).
	pub elements_visited: u32,
}

/// Decides whether any element of a stored document matches a planned
/// selector list, using the cheapest stage that is exact.
///
/// 1. Every alternative first passes the ordered-literal prefilter, which can
///    only reject a document that cannot match it. A document that lacks the
///    literals of every alternative is rejected without being read.
/// 2. Alternatives that one start tag decides (`direct`) are tried by reading
///    the start tags; a match ends the call. If the read reaches a
///    `<template` it stops and every surviving alternative goes to the next
///    stage.
/// 3. The rest run on the open-element stack.
///
/// The result is a judgement about the stored string read as markup with
/// balanced tags (see `docs/query.md` for the interpretation rules); it is
/// not guaranteed to equal the verdict on the DOM the string was serialized
/// from, because serialization is not injective.
///
/// # Examples
///
/// ```
/// use nitpicker_html_scan::{
///     Alternative, Compound, Conditions, SelectorPlan, html_matches_selector,
/// };
///
/// let plan = SelectorPlan {
///     alternatives: vec![Alternative {
///         compounds: vec![Compound {
///             conditions: Conditions { tag: Some("img".into()), ..Conditions::default() },
///             negations: vec![],
///         }],
///         combinators: vec![],
///         prefilter_literals: Some(vec![b"<img".to_vec()]),
///         direct: true,
///     }],
///     needs_child_index: false,
///     needs_type_index: false,
/// };
/// assert!(html_matches_selector(&plan, b"<p><img src=a></p>").matched);
/// ```
#[must_use]
pub fn html_matches_selector(plan: &SelectorPlan, html: &[u8]) -> HtmlMatchOutcome {
	let passes = |alternative: &&Alternative| {
		passes_ordered_prefilter(html, alternative.prefilter_literals.as_deref())
	};
	// Only the direct alternatives that pass the prefilter are read for: one that
	// fails it cannot match.
	let direct: Vec<&Alternative> = plan
		.alternatives
		.iter()
		.filter(|alternative| alternative.direct)
		.filter(passes)
		.collect();

	let mut direct_result = None;
	if !direct.is_empty() {
		let result = run_direct_match(html, &direct);
		if result == DirectMatch::Matched {
			return HtmlMatchOutcome {
				matched: true,
				..HtmlMatchOutcome::default()
			};
		}
		direct_result = Some(result);
	}

	let survivors: Vec<&Alternative> = plan
		.alternatives
		.iter()
		.filter(|alternative| !alternative.direct || direct_result == Some(DirectMatch::NeedsStack))
		.filter(passes)
		.collect();
	if survivors.is_empty() {
		// Rejected by literals alone only when no read of the markup took place.
		// (A read that hands over at a `<template` always leaves a survivor: the
		// alternative that read passed the prefilter.)
		return HtmlMatchOutcome {
			prefiltered: direct_result != Some(DirectMatch::Unmatched),
			..HtmlMatchOutcome::default()
		};
	}

	let outcome = run_selector_state_machine(
		html,
		&survivors,
		IndexNeeds {
			child: plan.needs_child_index,
			of_type: plan.needs_type_index,
		},
	);
	HtmlMatchOutcome {
		matched: outcome.matched,
		prefiltered: false,
		tokenized: true,
		elements_visited: outcome.elements_visited,
	}
}

#[cfg(test)]
mod tests {
	use super::{HtmlMatchOutcome, html_matches_selector};
	use crate::selector_plan::{
		Alternative, AttributeOperator, AttributeTest, Combinator, Compound, Conditions,
		SelectorPlan,
	};

	fn literals(list: &[&str]) -> Vec<Vec<u8>> {
		list.iter().map(|l| l.as_bytes().to_vec()).collect()
	}

	fn compound(tag: &str) -> Compound {
		Compound {
			conditions: Conditions {
				tag: Some(tag.to_owned()),
				..Conditions::default()
			},
			negations: vec![],
		}
	}

	fn direct_tag(tag: &str) -> Alternative {
		Alternative {
			compounds: vec![compound(tag)],
			combinators: vec![],
			prefilter_literals: Some(literals(&[&format!("<{tag}")])),
			direct: true,
		}
	}

	fn child_chain(a: &str, b: &str) -> Alternative {
		Alternative {
			compounds: vec![compound(a), compound(b)],
			combinators: vec![Combinator::Child],
			prefilter_literals: Some(literals(&[&format!("<{a}"), &format!("<{b}")])),
			direct: false,
		}
	}

	fn plan(alternatives: Vec<Alternative>) -> SelectorPlan {
		SelectorPlan {
			alternatives,
			needs_child_index: false,
			needs_type_index: false,
		}
	}

	#[test]
	fn a_direct_match_never_runs_the_stack() {
		let outcome = html_matches_selector(&plan(vec![direct_tag("img")]), b"<p><img></p>");
		assert_eq!(
			outcome,
			HtmlMatchOutcome {
				matched: true,
				..HtmlMatchOutcome::default()
			}
		);
	}

	#[test]
	fn a_document_without_the_literals_is_prefiltered() {
		let outcome = html_matches_selector(&plan(vec![direct_tag("img")]), b"<p>x</p>");
		assert_eq!(
			outcome,
			HtmlMatchOutcome {
				prefiltered: true,
				..HtmlMatchOutcome::default()
			}
		);
	}

	#[test]
	fn a_direct_read_that_finds_nothing_is_neither_prefiltered_nor_tokenized() {
		let outcome = html_matches_selector(&plan(vec![direct_tag("img")]), b"<p title=\"<img>\">");
		assert_eq!(outcome, HtmlMatchOutcome::default());
	}

	#[test]
	fn a_template_hands_the_document_to_the_stack() {
		let outcome = html_matches_selector(
			&plan(vec![direct_tag("img")]),
			b"<template><img></template>",
		);
		assert!(!outcome.matched);
		assert!(outcome.tokenized);
		assert_eq!(outcome.elements_visited, 1);
	}

	#[test]
	fn an_alternative_that_needs_the_stack_runs_it() {
		let outcome = html_matches_selector(&plan(vec![child_chain("a", "b")]), b"<a><b></b></a>");
		assert!(outcome.matched);
		assert!(outcome.tokenized);
		assert_eq!(outcome.elements_visited, 2);
	}

	#[test]
	fn only_alternatives_that_pass_the_prefilter_reach_the_stack() {
		let outcome = html_matches_selector(
			&plan(vec![child_chain("a", "b"), child_chain("x", "y")]),
			b"<x><y></y></x>",
		);
		assert!(outcome.matched);
		let outcome = html_matches_selector(
			&plan(vec![child_chain("a", "b"), child_chain("x", "y")]),
			b"<p></p>",
		);
		assert!(outcome.prefiltered);
		assert!(!outcome.tokenized);
	}

	#[test]
	fn an_alternative_without_literals_always_goes_on() {
		let any = Alternative {
			compounds: vec![
				Compound {
					conditions: Conditions {
						attributes: vec![AttributeTest {
							name: "x".to_owned(),
							operator: AttributeOperator::Exists,
							value: String::new(),
							ignore_case: false,
						}],
						..Conditions::default()
					},
					negations: vec![],
				},
				compound("b"),
			],
			combinators: vec![Combinator::Child],
			prefilter_literals: None,
			direct: false,
		};
		let outcome = html_matches_selector(&plan(vec![any]), b"<p></p>");
		assert!(!outcome.matched);
		assert!(outcome.tokenized);
	}

	#[test]
	fn only_the_direct_alternatives_that_pass_the_prefilter_decide_whether_to_read() {
		// `<img` is missing, so the `img` alternative could not match; `<b` is there.
		let both = plan(vec![direct_tag("img"), direct_tag("b")]);
		assert!(html_matches_selector(&both, b"<p><b></b></p>").matched);
		// Neither literal occurs: rejected without reading the markup.
		let outcome = html_matches_selector(&both, b"<p></p>");
		assert!(outcome.prefiltered);
		assert!(!outcome.matched);
	}

	#[test]
	fn a_template_sends_direct_and_stack_alternatives_to_the_stack_together() {
		let mixed = plan(vec![direct_tag("img"), child_chain("a", "b")]);
		// The direct read stops at the template; the `img` inside it is not searched,
		// and the chain is judged on the stack in the same pass.
		let outcome = html_matches_selector(&mixed, b"<template><img></template><a><b></b></a>");
		assert!(outcome.matched);
		assert!(outcome.tokenized);
		let outcome = html_matches_selector(&mixed, b"<template><img></template><p></p>");
		assert!(!outcome.matched);
		assert!(outcome.tokenized);
	}

	#[test]
	fn a_direct_miss_leaves_the_stack_alternatives_to_run() {
		let outcome = html_matches_selector(
			&plan(vec![direct_tag("img"), child_chain("a", "b")]),
			b"<img><a><b></b></a>",
		);
		assert!(outcome.matched);
	}
}
