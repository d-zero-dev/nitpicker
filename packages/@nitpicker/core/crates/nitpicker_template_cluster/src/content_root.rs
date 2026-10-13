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
			// `lastIndexOf` cannot miss before a confirmed closing tag; `-1`
			// would make JavaScript's `slice` count from the end.
			let end = winner.content_end.unwrap_or(html.len().saturating_sub(1));
			return Some(winner.content_start..end);
		}
	}
	None
}

#[cfg(test)]
mod tests {
	use super::{ContentRoot, find_content_root};

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
}
