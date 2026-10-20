use std::collections::HashMap;

use crate::element::Element;
use crate::matches_compound::matches_compound;
use crate::selector_plan::{Alternative, Combinator};
use crate::tag_tokenizer::{TagEvent, TagTokenizer};

/// What the open-element stack found in one document.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StackOutcome {
	/// Whether an element completed a chain of compounds for some alternative.
	pub matched: bool,
	/// How many elements were tested (an early exit keeps this small).
	pub elements_visited: u32,
}

/// What a document's sibling positions are counted for.
#[derive(Clone, Copy, Debug)]
pub struct IndexNeeds {
	/// Whether any alternative tests `:nth-child` / `:first-child`.
	pub child: bool,
	/// Whether any alternative tests `:nth-of-type` / `:first-of-type`.
	pub of_type: bool,
}

/// What the stack remembers per open element, indexed by depth. Frame 0 is a
/// virtual root above `<html>`. A frame's slot is reused when a later element
/// opens at the same depth.
struct Frames<'a> {
	/// The open element's tag name as written.
	names: Vec<&'a [u8]>,
	/// How many child elements the open element has had so far.
	child_counts: Vec<u32>,
	/// How many child elements of each (lower-cased) name it has had; made on first use.
	type_counts: Vec<Option<HashMap<Vec<u8>, u32>>>,
	/// Where a name is lower-cased to look it up in `type_counts`.
	scratch: Vec<u8>,
}

impl<'a> Frames<'a> {
	fn new() -> Self {
		Self {
			names: vec![b""],
			child_counts: vec![0],
			type_counts: vec![None],
			scratch: Vec::new(),
		}
	}

	/// Opens the frame of an element at `depth`, with no children yet.
	fn open(&mut self, depth: usize, name: &'a [u8]) {
		if self.names.len() <= depth {
			self.names.push(name);
			self.child_counts.push(0);
			self.type_counts.push(None);
		} else {
			self.names[depth] = name;
			self.child_counts[depth] = 0;
			self.type_counts[depth] = None;
		}
	}

	/// Counts a new child element called `name` of the element at `parent`, and
	/// records its sibling positions on `element` for the positions `needs` asks for.
	fn count_sibling(
		&mut self,
		parent: usize,
		name: &[u8],
		needs: IndexNeeds,
		element: &mut Element,
	) {
		if needs.child {
			self.child_counts[parent] += 1;
			element.child_index = self.child_counts[parent];
		}
		if needs.of_type {
			// The name is lower-cased into a buffer that lives as long as the stack, and
			// copied into the map only the first time a parent sees it.
			self.scratch.clear();
			self.scratch.extend(name.iter().map(u8::to_ascii_lowercase));
			let counts = self.type_counts[parent].get_or_insert_with(HashMap::new);
			let seen = if let Some(seen) = counts.get_mut(self.scratch.as_slice()) {
				seen
			} else {
				counts.entry(self.scratch.clone()).or_insert(0)
			};
			*seen += 1;
			element.type_index = *seen;
		}
	}
}

/// The compounds of `alternative` that `element` completes a chain up to:
/// bit `j` is set when `element` satisfies compound `j` and, for `j > 0`, the
/// compounds before it are matched along the path above it, joined by their
/// combinators. `parent` is the state set of the element's parent and the
/// union of its ancestors' (the parent's own excluded).
fn chain_states(alternative: &Alternative, parent: (u32, u32), element: &mut Element) -> u32 {
	let (parent_states, parent_ancestors) = parent;
	let mut result = 0_u32;
	for (j, compound) in alternative.compounds.iter().enumerate() {
		if j > 0 {
			let reachable = match alternative.combinators[j - 1] {
				Combinator::Child => parent_states,
				Combinator::Descendant => parent_states | parent_ancestors,
			};
			if reachable & (1 << (j - 1)) == 0 {
				continue;
			}
		}
		if matches_compound(compound, element) {
			result |= 1 << j;
		}
	}
	result
}

/// Evaluates selector alternatives over stored markup with an open-element
/// stack, never building a tree.
///
/// Per alternative, each stack frame keeps `states`: the set of compound
/// indices `j` for which "compounds 0..j match along the path ending at this
/// element, joined by their combinators". A new element `e` with parent `p`
/// gets compound `j` when it satisfies that compound and either `j` is 0, or
/// the combinator before `j` is a child combinator and `j - 1` is in
/// `p.states`, or it is a descendant combinator and `j - 1` is in `p.states`
/// or in the union of all ancestors' states. This depends only on the
/// element, its parent chain and its earlier siblings, which is why one
/// forward pass is exact — and why `:has()`, `+`, `~` and `:last-child`
/// cannot be added without a tree. Different paths that reach the same
/// compound merge into one bit, which loses nothing because the answer is
/// only whether some element completes a chain.
///
/// Time is O(elements × compounds); the state arrays take O(depth ×
/// alternatives). It stops at the first element that completes a chain.
///
/// The content of a `<template>` is a separate fragment in the DOM that
/// `querySelectorAll` never enters, so its descendants are skipped; the
/// `template` element itself is still tested. Inside a template only a
/// `</template>` ends it (matching the nested templates opened in its
/// content), however many elements it leaves unclosed. An end tag that does
/// not name the innermost open element is ignored, and an element never
/// closed stays open to the end of the document.
#[must_use]
pub fn run_selector_state_machine(
	html: &[u8],
	alternatives: &[&Alternative],
	needs: IndexNeeds,
) -> StackOutcome {
	let count = alternatives.len();
	let final_bits: Vec<u32> = alternatives
		.iter()
		.map(|alternative| 1_u32 << (alternative.compounds.len() - 1))
		.collect();

	let mut states: Vec<u32> = vec![0; 32 * count];
	let mut ancestor_states: Vec<u32> = vec![0; 32 * count];
	let mut frames = Frames::new();
	let mut depth = 0_usize;
	// None outside a template; inside one, how many templates are open within its
	// content (only a template's own end tag closes a template, whatever else is
	// left unclosed inside it).
	let mut template_depth: Option<u32> = None;
	let mut elements_visited = 0_u32;

	let mut element = Element::new();
	let mut tokenizer = TagTokenizer::new(html);

	while let Some(event) = tokenizer.next_event() {
		let (name, attributes, leaf) = match event {
			TagEvent::Close { name } => {
				if let Some(nested) = template_depth {
					// An end tag other than `</template>` in the content is not the end of it.
					if !name.eq_ignore_ascii_case(b"template") {
						continue;
					}
					if nested > 0 {
						template_depth = Some(nested - 1);
						continue;
					}
					template_depth = None;
				}
				if frames.names[depth].eq_ignore_ascii_case(name) {
					depth -= 1;
				}
				continue;
			}
			TagEvent::Open {
				name,
				attributes,
				leaf,
			} => (name, attributes, leaf),
		};
		if let Some(nested) = template_depth {
			if !leaf && name.eq_ignore_ascii_case(b"template") {
				template_depth = Some(nested + 1);
			}
			continue;
		}

		let parent = depth;
		frames.count_sibling(parent, name, needs, &mut element);
		element.set(name, attributes);
		elements_visited += 1;

		let needed = (parent + 2) * count;
		if needed > states.len() {
			let grown = needed.max(states.len() * 2);
			states.resize(grown, 0);
			ancestor_states.resize(grown, 0);
		}

		let parent_base = parent * count;
		let next_base = (parent + 1) * count;
		for (index, alternative) in alternatives.iter().enumerate() {
			let parent_states = states[parent_base + index];
			let parent_ancestors = ancestor_states[parent_base + index];
			let result = chain_states(alternative, (parent_states, parent_ancestors), &mut element);
			if result & final_bits[index] != 0 {
				return StackOutcome {
					matched: true,
					elements_visited,
				};
			}
			states[next_base + index] = result;
			ancestor_states[next_base + index] = parent_ancestors | parent_states;
		}

		if !leaf {
			depth += 1;
			frames.open(depth, name);
			if name.eq_ignore_ascii_case(b"template") {
				template_depth = Some(0);
			}
		}
	}
	StackOutcome {
		matched: false,
		elements_visited,
	}
}

#[cfg(test)]
mod tests {
	use super::{IndexNeeds, StackOutcome, run_selector_state_machine};
	use crate::selector_plan::{
		Alternative, AttributeOperator, AttributeTest, Combinator, Compound, Conditions, NthTest,
	};

	fn tag(name: &str) -> Compound {
		Compound {
			conditions: Conditions {
				tag: Some(name.to_owned()),
				..Conditions::default()
			},
			negations: vec![],
		}
	}

	fn chain(compounds: Vec<Compound>, combinators: Vec<Combinator>) -> Alternative {
		Alternative {
			compounds,
			combinators,
			prefilter_literals: None,
			direct: false,
		}
	}

	fn run(html: &str, alternative: &Alternative) -> StackOutcome {
		let needs = IndexNeeds {
			child: alternative
				.compounds
				.iter()
				.any(|c| c.conditions.nth.iter().any(|n| !n.of_type)),
			of_type: alternative
				.compounds
				.iter()
				.any(|c| c.conditions.nth.iter().any(|n| n.of_type)),
		};
		run_selector_state_machine(html.as_bytes(), &[alternative], needs)
	}

	fn matched(html: &str, alternative: &Alternative) -> bool {
		run(html, alternative).matched
	}

	fn descendant(a: &str, b: &str) -> Alternative {
		chain(vec![tag(a), tag(b)], vec![Combinator::Descendant])
	}

	fn child(a: &str, b: &str) -> Alternative {
		chain(vec![tag(a), tag(b)], vec![Combinator::Child])
	}

	#[test]
	fn a_descendant_combinator_reaches_through_any_depth() {
		let selector = descendant("a", "b");
		assert!(matched("<a><i><b></b></i></a>", &selector));
		assert!(!matched("<a></a><b></b>", &selector));
	}

	#[test]
	fn a_child_combinator_needs_the_direct_parent() {
		let selector = child("a", "b");
		assert!(matched("<a><b></b></a>", &selector));
		assert!(!matched("<a><i><b></b></i></a>", &selector));
	}

	#[test]
	fn counts_only_the_elements_it_tested_before_stopping() {
		let selector = descendant("a", "b");
		assert_eq!(run("<a></a><i></i>", &selector).elements_visited, 2);
		assert_eq!(run("<a><b></b></a><i></i>", &selector).elements_visited, 2);
		assert_eq!(
			run("", &selector),
			StackOutcome {
				matched: false,
				elements_visited: 0
			}
		);
	}

	#[test]
	fn an_unclosed_element_stays_open() {
		let selector = child("b", "p");
		assert!(matched("<div><b></div><p>", &selector));
	}

	#[test]
	fn does_not_pop_for_an_end_tag_that_names_another_element() {
		let selector = child("a", "b");
		assert!(matched("<a></i><b>", &selector));
	}

	#[test]
	fn an_implicit_close_is_not_applied() {
		assert!(matched("<p><div></div></p>", &child("p", "div")));
	}

	#[test]
	fn void_and_self_closed_elements_take_no_children() {
		let selector = child("br", "b");
		assert!(!matched("<br><b>", &selector));
		assert!(!matched("<x/><b>", &child("x", "b")));
	}

	#[test]
	fn a_raw_text_element_has_no_children_and_its_content_is_not_markup() {
		assert!(!matched("<script><b></b></script>", &child("script", "b")));
		assert!(matched("<script></script><b>", &tag_alone("b")));
	}

	fn tag_alone(name: &str) -> Alternative {
		chain(vec![tag(name)], vec![])
	}

	#[test]
	fn skips_the_content_of_a_template_but_tests_the_template_itself() {
		assert!(matched(
			"<template><b></b></template>",
			&tag_alone("template")
		));
		assert!(!matched("<template><b></b></template>", &tag_alone("b")));
		assert!(matched("<template></template><b>", &tag_alone("b")));
	}

	#[test]
	fn a_nested_template_closes_with_its_own_end_tag() {
		let html = "<template><template><i></i></template><i></i></template><b>";
		assert!(matched(html, &tag_alone("b")));
		assert!(!matched(html, &tag_alone("i")));
	}

	#[test]
	fn a_template_end_tag_closes_it_however_many_elements_are_left_open_inside() {
		// `</template>` ends the template even with a `div` unclosed in its content,
		// as in the DOM; the `b` after it is outside.
		assert!(matched("<template><div></template><b>", &tag_alone("b")));
		assert!(!matched("<template><div><b></template>", &tag_alone("b")));
		assert!(matched(
			"<template><template><div></template><b></template><i>",
			&tag_alone("i")
		));
		assert!(!matched(
			"<template><template><div></template><b></template><i>",
			&tag_alone("b")
		));
	}

	#[test]
	fn an_end_tag_inside_a_template_other_than_its_own_does_not_close_it() {
		assert!(!matched(
			"<template></p><i></i></template>",
			&tag_alone("i")
		));
	}

	fn nth_child(a: f64, b: f64) -> Alternative {
		chain(
			vec![Compound {
				conditions: Conditions {
					tag: Some("li".to_owned()),
					nth: vec![NthTest {
						of_type: false,
						a,
						b,
					}],
					..Conditions::default()
				},
				negations: vec![],
			}],
			vec![],
		)
	}

	#[test]
	fn counts_sibling_positions_per_parent() {
		assert!(matched("<ul><li></li><li></li></ul>", &nth_child(0.0, 2.0)));
		assert!(!matched(
			"<ul><li></li></ul><ul><li></li></ul>",
			&nth_child(0.0, 2.0)
		));
	}

	#[test]
	fn counts_positions_among_elements_of_the_same_name() {
		let second_p = chain(
			vec![Compound {
				conditions: Conditions {
					tag: Some("p".to_owned()),
					nth: vec![NthTest {
						of_type: true,
						a: 0.0,
						b: 2.0,
					}],
					..Conditions::default()
				},
				negations: vec![],
			}],
			vec![],
		);
		assert!(matched("<div><p></p><i></i><P></P></div>", &second_p));
		assert!(!matched("<div><p></p><i></i><b></b></div>", &second_p));
	}

	#[test]
	fn reads_attributes_of_the_element_under_test() {
		let selector = chain(
			vec![
				tag("nav"),
				Compound {
					conditions: Conditions {
						tag: Some("a".to_owned()),
						attributes: vec![AttributeTest {
							name: "href".to_owned(),
							operator: AttributeOperator::Prefix,
							value: "/p/".to_owned(),
							ignore_case: false,
						}],
						..Conditions::default()
					},
					negations: vec![],
				},
			],
			vec![Combinator::Child],
		);
		assert!(matched("<nav><a href=\"/p/x\">", &selector));
		assert!(!matched("<nav><a href=\"/q/x\">", &selector));
	}

	#[test]
	fn handles_a_document_deeper_than_the_initial_state_arrays() {
		let mut html = String::new();
		for _ in 0..200 {
			html.push_str("<div>");
		}
		html.push_str("<b>");
		assert!(matched(&html, &descendant("div", "b")));
	}

	fn run_all(html: &str, alternatives: &[&Alternative]) -> bool {
		run_selector_state_machine(
			html.as_bytes(),
			alternatives,
			IndexNeeds {
				child: true,
				of_type: true,
			},
		)
		.matched
	}

	#[test]
	fn completes_a_chain_along_a_path_only() {
		let chain3 = chain(
			vec![tag("a"), tag("b"), tag("c")],
			vec![Combinator::Child, Combinator::Descendant],
		);
		assert!(matched("<a><b><x><c></c></x></b></a>", &chain3));
		assert!(!matched("<a><x><b><c></c></b></x></a>", &chain3));
	}

	#[test]
	fn forgets_a_branch_when_its_element_closes() {
		assert!(!matched("<a></a><c></c>", &descendant("a", "c")));
		let chain3 = chain(
			vec![tag("a"), tag("b"), tag("c")],
			vec![Combinator::Child, Combinator::Child],
		);
		assert!(!matched("<a><b></b></a><c></c>", &chain3));
	}

	#[test]
	fn merges_different_paths_to_the_same_state() {
		assert!(matched(
			"<a><a><x></x></a><b></b></a>",
			&descendant("a", "b")
		));
	}

	#[test]
	fn evaluates_several_alternatives_in_one_pass() {
		let list = [descendant("x", "y"), child("a", "b")];
		let refs: Vec<&Alternative> = list.iter().collect();
		assert!(run_all("<a><b></b></a>", &refs));
		assert!(!run_all("<x><a></a></x>", &refs));
	}

	#[test]
	fn grows_its_stacks_for_a_very_deep_document_and_several_alternatives() {
		let depth = 5000;
		let html = "<div>".repeat(depth) + "<p></p>" + &"</div>".repeat(depth);
		assert!(matched(&html, &child("div", "p")));
		assert!(!matched(&html, &descendant("p", "p")));
		let list = [
			descendant("x", "y"),
			chain(
				vec![tag("div"), tag("div"), tag("p")],
				vec![Combinator::Descendant, Combinator::Child],
			),
		];
		let refs: Vec<&Alternative> = list.iter().collect();
		assert!(run_all(&html, &refs));
		let none = [descendant("p", "p"), descendant("q", "q")];
		let refs: Vec<&Alternative> = none.iter().collect();
		assert!(!run_all(&html, &refs));
	}

	#[test]
	fn the_template_element_counts_as_a_sibling_but_its_content_does_not() {
		let html = "<body><b></b><template><p></p><p></p></template><p></p></body>";
		let nth_p = |b: f64| {
			chain(
				vec![Compound {
					conditions: Conditions {
						tag: Some("p".to_owned()),
						nth: vec![NthTest {
							of_type: false,
							a: 0.0,
							b,
						}],
						..Conditions::default()
					},
					negations: vec![],
				}],
				vec![],
			)
		};
		assert!(matched(html, &nth_p(3.0)));
		assert!(!matched(html, &nth_p(2.0)));
		assert!(!matched(html, &nth_p(4.0)));
	}

	#[test]
	fn skips_template_descendants_for_combinators_too() {
		assert!(!matched(
			"<body><template><template></template><img></template></body>",
			&descendant("body", "img")
		));
		assert!(matched(
			"<body><template></template><img></body>",
			&descendant("body", "img")
		));
		assert!(!matched(
			"<template><img></template>",
			&child("template", "img")
		));
		assert!(matched(
			"<body><template><p></p></template><img></body>",
			&child("body", "img")
		));
		assert!(matched(
			"<template></p><img></template><img>",
			&tag_alone("img")
		));
		assert!(!matched(
			"<template><p></p></p><img></template>",
			&tag_alone("img")
		));
	}

	#[test]
	fn counts_positions_among_siblings_that_have_no_children() {
		assert!(matched(
			"<div><br><img><p></p></div>",
			&nth_child_of("p", 3.0)
		));
	}

	fn nth_child_of(name: &str, b: f64) -> Alternative {
		chain(
			vec![Compound {
				conditions: Conditions {
					tag: Some(name.to_owned()),
					nth: vec![NthTest {
						of_type: false,
						a: 0.0,
						b,
					}],
					..Conditions::default()
				},
				negations: vec![],
			}],
			vec![],
		)
	}
}
