use std::ops::Range;

use nitpicker_html_parser::{Attributes, Document, to_lower_case_js};

use crate::find_matching_elements::find_matching_elements;
use crate::js_string::js_split_whitespace;

/// The element a crawler reported as a page's main content: every given
/// field must match the same element. Empty strings and lists count as not
/// given; a root with nothing given matches nothing.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ContentRoot {
	/// Compared case-insensitively.
	pub tag_name: Option<String>,
	/// Compared exactly.
	pub id: Option<String>,
	/// Compared exactly.
	pub role: Option<String>,
	/// All must be among the element's classes.
	pub class_list: Vec<String>,
}

/// Tried after the hint and `<main>` / `role="main"`, in this order — the
/// list a crawler walks to detect the main content, so a page clustered
/// without the crawler's hint resolves to the element it would have
/// reported.
fn fallbacks() -> [ContentRoot; 12] {
	let id = |id: &str| ContentRoot {
		id: Some(id.to_owned()),
		..ContentRoot::default()
	};
	let class = |class: &str| ContentRoot {
		class_list: vec![class.to_owned()],
		..ContentRoot::default()
	};
	[
		id("main"),
		class("main"),
		id("content"),
		class("content"),
		id("contents"),
		class("contents"),
		id("main-content"),
		class("main-content"),
		id("main_content"),
		class("main_content"),
		id("mainContent"),
		class("mainContent"),
	]
}

/// Whether the element (raw attributes) is `root`. `<body>` never is.
#[must_use]
pub fn matches_content_root(
	root: &ContentRoot,
	html: &str,
	tag: &str,
	attributes: &Attributes,
) -> bool {
	if tag == "body" {
		return false;
	}
	let wanted_tag = root
		.tag_name
		.as_deref()
		.filter(|tag| !tag.is_empty())
		.map(to_lower_case_js);
	let wanted_id = root.id.as_deref().filter(|id| !id.is_empty());
	let wanted_role = root.role.as_deref().filter(|role| !role.is_empty());
	let wanted_classes: Vec<&str> = root
		.class_list
		.iter()
		.map(String::as_str)
		.filter(|class| !class.is_empty())
		.collect();
	if wanted_tag.is_none()
		&& wanted_id.is_none()
		&& wanted_role.is_none()
		&& wanted_classes.is_empty()
	{
		return false;
	}
	if wanted_tag.is_some_and(|wanted| wanted != tag) {
		return false;
	}
	let raw = |value: &Option<nitpicker_html_parser::AttributeValue>| {
		value.as_ref().map(|value| value.raw(html))
	};
	if wanted_id.is_some_and(|wanted| raw(&attributes.id) != Some(wanted)) {
		return false;
	}
	if wanted_role.is_some_and(|wanted| raw(&attributes.role) != Some(wanted)) {
		return false;
	}
	if !wanted_classes.is_empty() {
		let present: Vec<&str> =
			js_split_whitespace(raw(&attributes.class).unwrap_or("")).collect();
		if !wanted_classes.iter().all(|class| present.contains(class)) {
			return false;
		}
	}
	true
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
	Hint,
	Main,
	Fallback(usize),
}

/// The content of the page's content root — the hint when it matches,
/// else the shallowest `<main>` / `role="main"`, else the first fallback
/// that matches (shallowest within each kind) — or `None` without one.
///
/// A hint matching nothing falls through rather than leaving the page
/// uncapped: a crawler reads the rendered DOM, so an id or class added by
/// script is missing from the stored HTML.
#[must_use]
pub fn find_content_root(
	html: &str,
	document: &Document,
	hint: Option<&ContentRoot>,
) -> Option<Range<usize>> {
	let fallbacks = fallbacks();
	let matches = find_matching_elements(html, document, |tag, role, attributes| {
		let mut kinds = Vec::new();
		if hint.is_some_and(|hint| matches_content_root(hint, html, tag, attributes)) {
			kinds.push(Kind::Hint);
		}
		if tag == "main" || role == Some("main") {
			kinds.push(Kind::Main);
		}
		for (index, fallback) in fallbacks.iter().enumerate() {
			if matches_content_root(fallback, html, tag, attributes) {
				kinds.push(Kind::Fallback(index));
			}
		}
		kinds
	});

	let priority = std::iter::once(Kind::Hint)
		.chain(std::iter::once(Kind::Main))
		.chain((0..fallbacks.len()).map(Kind::Fallback));
	for kind in priority {
		let winner = matches
			.iter()
			.filter(|element| element.kind == kind)
			.reduce(|best, element| {
				if element.depth < best.depth
					|| (element.depth == best.depth && element.start < best.start)
				{
					element
				} else {
					best
				}
			});
		if let Some(winner) = winner {
			// `lastIndexOf` cannot miss before a confirmed closing tag, so the
			// fallback is unreachable; it spells out what `-1` would have done
			// (JavaScript's `slice` counting from the end) rather than panic.
			let end = winner.content_end.unwrap_or(html.len().saturating_sub(1));
			return Some(winner.content_start..end);
		}
	}
	None
}

#[cfg(test)]
mod tests {
	use super::{ContentRoot, fallbacks, find_content_root, matches_content_root};

	fn content(html: &str, hint: Option<&ContentRoot>) -> Option<String> {
		let document = nitpicker_html_parser::parse(html);
		find_content_root(html, &document, hint).map(|range| html[range].to_owned())
	}

	#[test]
	fn prefers_the_hint_then_main_then_the_fallbacks() {
		let html = "<body><div id=\"wrap\"><main><p>m</p></main><div class=\"content\">c</div></div></body>";
		let hint = ContentRoot {
			tag_name: Some("DIV".to_owned()),
			id: Some("wrap".to_owned()),
			..ContentRoot::default()
		};
		assert_eq!(
			content(html, Some(&hint)).as_deref(),
			Some("<main><p>m</p></main><div class=\"content\">c</div>")
		);
		assert_eq!(content(html, None).as_deref(), Some("<p>m</p>"));
		assert_eq!(
			content("<body><div class=\"x content\">c</div></body>", None).as_deref(),
			Some("c")
		);
	}

	#[test]
	fn falls_through_a_hint_that_matches_nothing() {
		let hint = ContentRoot {
			id: Some("app".to_owned()),
			..ContentRoot::default()
		};
		assert_eq!(
			content("<body><div id=\"main\">m</div></body>", Some(&hint)).as_deref(),
			Some("m")
		);
	}

	#[test]
	fn never_takes_body_or_an_empty_hint() {
		assert_eq!(content("<body id=\"main\">x</body>", None), None);
		assert_eq!(
			content("<body><p>x</p></body>", Some(&ContentRoot::default())),
			None
		);
	}

	fn root(
		tag_name: Option<&str>,
		id: Option<&str>,
		role: Option<&str>,
		class_list: &[&str],
	) -> ContentRoot {
		ContentRoot {
			tag_name: tag_name.map(str::to_owned),
			id: id.map(str::to_owned),
			role: role.map(str::to_owned),
			class_list: class_list.iter().map(|class| (*class).to_owned()).collect(),
		}
	}

	fn id_root(id: &str) -> ContentRoot {
		root(None, Some(id), None, &[])
	}

	fn matches(root: &ContentRoot, tag: &str, attributes: &str) -> bool {
		let html = if tag == "body" {
			format!("<body {attributes}></body>")
		} else {
			format!("<body><{tag} {attributes}></{tag}></body>")
		};
		let document = nitpicker_html_parser::parse(&html);
		let event = document
			.events
			.iter()
			.find(|event| document.tag_name(event.name) == tag)
			.expect("the element is parsed");
		matches_content_root(root, &html, tag, document.attributes_of(event))
	}

	#[test]
	fn matches_when_every_given_field_matches() {
		let wanted = root(Some("DIV"), Some("main"), None, &["spc"]);
		assert!(matches(&wanted, "div", "id=\"main\" class=\"spc wide\""));
		assert!(!matches(&wanted, "div", "id=\"main\""));
		assert!(!matches(&ContentRoot::default(), "div", "id=\"main\""));
	}

	#[test]
	fn compares_the_tag_name_case_insensitively() {
		assert!(matches(&root(Some("DIV"), None, None, &[]), "div", ""));
		assert!(!matches(&root(Some("div"), None, None, &[]), "section", ""));
	}

	#[test]
	fn compares_the_id_exactly() {
		assert!(matches(&id_root("main"), "div", "id=\"main\""));
		assert!(!matches(&id_root("main"), "div", "id=\"main-content\""));
		assert!(!matches(&id_root("main"), "div", ""));
	}

	#[test]
	fn compares_the_role_exactly() {
		let wanted = root(None, None, Some("main"), &[]);
		assert!(matches(&wanted, "div", "role=\"main\""));
		assert!(!matches(&wanted, "div", "role=\"banner\""));
	}

	#[test]
	fn matches_classes_as_a_subset_regardless_of_order_and_extras() {
		assert!(matches(
			&root(None, None, None, &["b", "a"]),
			"div",
			"class=\"a x b\""
		));
		assert!(!matches(
			&root(None, None, None, &["a", "c"]),
			"div",
			"class=\"a b\""
		));
	}

	#[test]
	fn splits_the_class_attribute_on_any_run_of_whitespace() {
		assert!(matches(
			&root(None, None, None, &["a", "b"]),
			"div",
			"class=\"  a \n\t b  \""
		));
	}

	#[test]
	fn requires_every_given_field_to_match_the_same_element() {
		let wanted = root(Some("div"), Some("main"), Some("main"), &["spc"]);
		assert!(matches(
			&wanted,
			"div",
			"id=\"main\" role=\"main\" class=\"spc\""
		));
		assert!(!matches(&wanted, "div", "id=\"main\" class=\"spc\""));
		assert!(!matches(
			&wanted,
			"section",
			"id=\"main\" role=\"main\" class=\"spc\""
		));
	}

	#[test]
	fn matches_nothing_for_a_root_without_constraints() {
		assert!(!matches(&ContentRoot::default(), "div", "id=\"main\""));
		assert!(!matches(
			&root(Some(""), Some(""), Some(""), &[]),
			"div",
			""
		));
		assert!(!matches(&root(None, None, None, &[]), "div", "class=\"a\""));
		assert!(!matches(
			&root(None, None, None, &[""]),
			"div",
			"class=\"a\""
		));
	}

	#[test]
	fn ignores_empty_fields_next_to_real_constraints() {
		assert!(matches(
			&root(Some(""), Some("main"), None, &[]),
			"div",
			"id=\"main\""
		));
	}

	#[test]
	fn never_matches_body() {
		assert!(!matches(&id_root("main"), "body", "id=\"main\""));
		assert!(!matches(&root(Some("body"), None, None, &[]), "body", ""));
		assert!(!matches(
			&root(None, None, None, &["home"]),
			"body",
			"class=\"home\""
		));
	}

	#[test]
	fn a_whitespace_only_class_attribute_has_no_classes() {
		assert!(!matches(
			&root(None, None, None, &["a"]),
			"div",
			"class=\"   \""
		));
	}

	#[test]
	fn a_class_constraint_never_matches_an_element_without_class() {
		assert!(!matches(&root(None, None, None, &["a"]), "div", ""));
	}

	#[test]
	fn duplicate_wanted_classes_need_one_occurrence() {
		assert!(matches(
			&root(None, None, None, &["a", "a"]),
			"div",
			"class=\"a\""
		));
	}

	#[test]
	fn compares_class_and_role_case_sensitively() {
		assert!(!matches(
			&root(None, None, None, &["Main"]),
			"div",
			"class=\"main\""
		));
		assert!(!matches(
			&root(None, None, Some("Main"), &[]),
			"div",
			"role=\"main\""
		));
	}

	#[test]
	fn lists_the_fallbacks_in_priority_order_with_id_before_class() {
		assert_eq!(
			fallbacks().to_vec(),
			vec![
				id_root("main"),
				root(None, None, None, &["main"]),
				id_root("content"),
				root(None, None, None, &["content"]),
				id_root("contents"),
				root(None, None, None, &["contents"]),
				id_root("main-content"),
				root(None, None, None, &["main-content"]),
				id_root("main_content"),
				root(None, None, None, &["main_content"]),
				id_root("mainContent"),
				root(None, None, None, &["mainContent"]),
			]
		);
	}

	#[test]
	fn resolves_a_hint_with_tag_and_id() {
		assert_eq!(
			content(
				"<body><div id=\"main\"><div><div><p>too deep</p></div></div></div></body>",
				Some(&root(Some("div"), Some("main"), None, &[]))
			)
			.as_deref(),
			Some("<div><div><p>too deep</p></div></div>")
		);
	}

	#[test]
	fn a_hint_outside_every_fallback_anchors_the_root() {
		let html = "<body><div id=\"page\"><div><div><p>deep</p></div></div></div></body>";
		assert_eq!(
			content(html, Some(&id_root("page"))).as_deref(),
			Some("<div><div><p>deep</p></div></div>")
		);
		assert_eq!(content(html, None), None);
	}

	#[test]
	fn a_hint_class_list_is_a_subset_match() {
		let html =
			"<body><div id=\"page\" class=\"spc wide\"><div><div>deep</div></div></div></body>";
		assert_eq!(
			content(html, Some(&root(None, Some("page"), None, &["spc"]))).as_deref(),
			Some("<div><div>deep</div></div>")
		);
		assert_eq!(
			content(
				html,
				Some(&root(None, Some("page"), None, &["spc", "narrow"]))
			),
			None
		);
	}

	#[test]
	fn the_hint_wins_over_a_real_main() {
		let html = "<body><main><div><div>a</div></div></main><div id=\"page\"><div><div>b</div></div></div></body>";
		assert_eq!(
			content(html, Some(&id_root("page"))).as_deref(),
			Some("<div><div>b</div></div>")
		);
		assert_eq!(
			content(html, None).as_deref(),
			Some("<div><div>a</div></div>")
		);
	}

	#[test]
	fn a_hint_matching_nothing_falls_back_to_main() {
		assert_eq!(
			content(
				"<body><main><div><div>deep</div></div></main></body>",
				Some(&id_root("added-by-script"))
			)
			.as_deref(),
			Some("<div><div>deep</div></div>")
		);
	}

	#[test]
	fn recognizes_role_main_without_a_main_tag() {
		assert_eq!(
			content(
				"<body><div role=\"main\"><div><div><div>deep</div></div></div></div></body>",
				None
			)
			.as_deref(),
			Some("<div><div><div>deep</div></div></div>")
		);
	}

	#[test]
	fn finds_no_root_in_a_page_without_main_or_fallbacks() {
		assert_eq!(content("<body><p>no main here</p></body>", None), None);
	}

	#[test]
	fn prefers_the_shallowest_main() {
		assert_eq!(
			content(
				"<body><div><main><div><div><div>deep</div></div></div></main></div><main><div><div><div>also-deep</div></div></div></main></body>",
				None
			)
			.as_deref(),
			Some("<div><div><div>also-deep</div></div></div>")
		);
	}

	#[test]
	fn tries_the_fallbacks_in_order_and_main_before_them() {
		let with_both = "<body><div id=\"content\"><div><div>c</div></div></div><div id=\"main\"><div><div>m</div></div></div></body>";
		assert_eq!(
			content(with_both, None).as_deref(),
			Some("<div><div>m</div></div>")
		);
		let with_main = "<body><div id=\"main\"><div><div>m</div></div></div><main><div><div>x</div></div></main></body>";
		assert_eq!(
			content(with_main, None).as_deref(),
			Some("<div><div>x</div></div>")
		);
	}

	#[test]
	fn a_class_fallback_anchors_the_root_without_an_id_one() {
		assert_eq!(
			content(
				"<body><div class=\"wrap content\"><div><div>d</div></div></div></body>",
				None
			)
			.as_deref(),
			Some("<div><div>d</div></div>")
		);
	}

	#[test]
	fn never_takes_body_even_with_the_hinted_id() {
		assert_eq!(
			content(
				"<body id=\"main\"><div><div>deep</div></div></body>",
				Some(&id_root("main"))
			),
			None
		);
	}

	#[test]
	fn prefers_the_shallowest_of_twice_hinted_elements() {
		assert_eq!(
			content(
				"<body><div id=\"page\"><div><p>a</p></div></div><section><div id=\"page\"><div><p>b</p></div></div></section></body>",
				Some(&id_root("page"))
			)
			.as_deref(),
			Some("<div><p>a</p></div>")
		);
	}

	#[test]
	fn a_deeper_hint_still_beats_a_shallower_main() {
		assert_eq!(
			content(
				"<body><main><div><div>a</div></div></main><section><div id=\"page\"><div><div>b</div></div></div></section></body>",
				Some(&id_root("page"))
			)
			.as_deref(),
			Some("<div><div>b</div></div>")
		);
	}

	#[test]
	fn a_deeper_main_id_still_beats_a_shallower_content_id() {
		assert_eq!(
			content(
				"<body><div id=\"content\"><div><div>c</div></div></div><section><div id=\"main\"><div><div>m</div></div></div></section></body>",
				None
			)
			.as_deref(),
			Some("<div><div>m</div></div>")
		);
	}

	#[test]
	fn a_hint_inside_main_and_main_inside_a_hint_are_both_the_root() {
		assert_eq!(
			content(
				"<body><main><div><div id=\"page\"><div><div>x</div></div></div></div></main></body>",
				Some(&id_root("page"))
			)
			.as_deref(),
			Some("<div><div>x</div></div>")
		);
		assert_eq!(
			content(
				"<body><div id=\"page\"><div><main><div><div>x</div></div></main></div></div></body>",
				Some(&id_root("page"))
			)
			.as_deref(),
			Some("<div><main><div><div>x</div></div></main></div>")
		);
	}

	#[test]
	fn leaves_an_unclosed_main_content_up_to_its_closing_tag() {
		assert_eq!(
			content("<body><main><div><div>unclosed</main></body>", None).as_deref(),
			Some("<div><div>unclosed")
		);
	}

	#[test]
	fn every_fallback_anchors_the_root() {
		for attribute in [
			"id=\"main\"",
			"class=\"main\"",
			"id=\"content\"",
			"class=\"content\"",
			"id=\"contents\"",
			"class=\"contents\"",
			"id=\"main-content\"",
			"class=\"main-content\"",
			"id=\"main_content\"",
			"class=\"main_content\"",
			"id=\"mainContent\"",
			"class=\"mainContent\"",
		] {
			let html = format!("<body><div {attribute}><div><div>x</div></div></div></body>");
			assert_eq!(
				content(&html, None).as_deref(),
				Some("<div><div>x</div></div>"),
				"{attribute}"
			);
		}
	}
}
