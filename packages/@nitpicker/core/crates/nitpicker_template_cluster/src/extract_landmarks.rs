use std::ops::Range;

use nitpicker_html_parser::Document;

use crate::excise::excise;
use crate::find_matching_elements::{MatchingElement, find_matching_elements};

/// The regions treated as page chrome, by HTML5 tag or ARIA role.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum LandmarkType {
	/// `<header>` / `role="banner"`.
	Header,
	/// `<footer>` / `role="contentinfo"`.
	Footer,
	/// `<nav>` / `role="navigation"`.
	Nav,
	/// `<aside>` / `role="complementary"`.
	Aside,
	/// `role="form"` (a bare `<form>` is no landmark).
	Form,
	/// `<search>` / `role="search"`.
	Search,
}

impl LandmarkType {
	/// Every type, in the fixed order instance lists are built in.
	pub const ALL: [Self; 6] = [
		Self::Header,
		Self::Footer,
		Self::Nav,
		Self::Aside,
		Self::Form,
		Self::Search,
	];
}

/// Matching type, including `main`, which is content: it is found so that a
/// `<nav>` inside it is not mistaken for nested chrome, but never cut out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
	Landmark(LandmarkType),
	Main,
}

fn kind_by_tag(tag: &str) -> Option<Kind> {
	Some(match tag {
		"header" => Kind::Landmark(LandmarkType::Header),
		"footer" => Kind::Landmark(LandmarkType::Footer),
		"nav" => Kind::Landmark(LandmarkType::Nav),
		"aside" => Kind::Landmark(LandmarkType::Aside),
		"search" => Kind::Landmark(LandmarkType::Search),
		"main" => Kind::Main,
		_ => return None,
	})
}

fn kind_by_role(role: &str) -> Option<Kind> {
	Some(match role {
		"banner" => Kind::Landmark(LandmarkType::Header),
		"contentinfo" => Kind::Landmark(LandmarkType::Footer),
		"navigation" => Kind::Landmark(LandmarkType::Nav),
		"complementary" => Kind::Landmark(LandmarkType::Aside),
		"form" => Kind::Landmark(LandmarkType::Form),
		"search" => Kind::Landmark(LandmarkType::Search),
		"main" => Kind::Main,
		_ => return None,
	})
}

/// Every match — by tag and by `role` (exact, single-valued), both when
/// they differ: `<header role="navigation">` is a header and a nav.
fn match_kinds(tag: &str, role: Option<&str>) -> Vec<Kind> {
	let mut kinds = Vec::new();
	if let Some(kind) = kind_by_tag(tag) {
		kinds.push(kind);
	}
	if let Some(kind) = role.and_then(kind_by_role)
		&& !kinds.contains(&kind)
	{
		kinds.push(kind);
	}
	kinds
}

/// Drops every match strictly inside another one (a `<nav>` in a
/// `<header>` is one region of markup, which must not count twice). Equal
/// spans — one element matching two types — both stay.
fn keep_outermost(matches: &[MatchingElement<LandmarkType>]) -> Vec<MatchingElement<LandmarkType>> {
	let mut result: Vec<MatchingElement<LandmarkType>> = Vec::new();
	for candidate in matches {
		let contained = result.iter().any(|outer| {
			outer.start <= candidate.start
				&& candidate.end <= outer.end
				&& (outer.start < candidate.start || candidate.end < outer.end)
		});
		if !contained {
			result.push(*candidate);
		}
	}
	result
}

/// A page's chrome regions and the page with them cut out.
#[derive(Debug, Default)]
pub struct Landmarks {
	/// The outermost genuinely closed instances (byte ranges of the page), in
	/// [`LandmarkType::ALL`] order, document order within a type.
	pub instances: Vec<(LandmarkType, Range<usize>)>,
	/// The page with every instance cut out.
	pub remainder: String,
}

/// Finds the page's landmarks.
///
/// Every instance is collected rather than the shallowest one per type:
/// whether a landmark is site-wide chrome or section-local is decided later
/// from how many pages carry it, not by its depth here. A candidate whose
/// closing tag cannot be confirmed (see `is_genuine_close`) is discarded
/// rather than trusted to bound a cut.
#[must_use]
pub fn extract_landmarks(html: &str, document: &Document) -> Landmarks {
	let all = find_matching_elements(html, document, |tag, role, _attributes| {
		match_kinds(tag, role)
	});
	let excisable: Vec<MatchingElement<LandmarkType>> = all
		.iter()
		.filter_map(|element| match element.kind {
			Kind::Landmark(kind) => Some(MatchingElement {
				kind,
				depth: element.depth,
				start: element.start,
				end: element.end,
				content_start: element.content_start,
				content_end: element.content_end,
			}),
			Kind::Main => None,
		})
		.collect();
	let outermost = keep_outermost(&excisable);

	let mut instances = Vec::with_capacity(outermost.len());
	for kind in LandmarkType::ALL {
		for element in outermost.iter().filter(|element| element.kind == kind) {
			instances.push((kind, element.start..element.end));
		}
	}
	let spans: Vec<Range<usize>> = outermost
		.iter()
		.map(|element| element.start..element.end)
		.collect();
	Landmarks {
		instances,
		remainder: excise(html, &spans),
	}
}

#[cfg(test)]
mod tests {
	use super::{LandmarkType, extract_landmarks};

	fn run(html: &str) -> (Vec<(LandmarkType, String)>, String) {
		let document = nitpicker_html_parser::parse(html);
		let landmarks = extract_landmarks(html, &document);
		(
			landmarks
				.instances
				.into_iter()
				.map(|(kind, span)| (kind, html[span].to_owned()))
				.collect(),
			landmarks.remainder,
		)
	}

	#[test]
	fn cuts_out_chrome_but_not_main() {
		assert_eq!(
			run("<body><header>H</header><main>M</main><footer>F</footer></body>"),
			(
				vec![
					(LandmarkType::Header, "<header>H</header>".to_owned()),
					(LandmarkType::Footer, "<footer>F</footer>".to_owned()),
				],
				"<body><main>M</main></body>".to_owned()
			)
		);
	}

	#[test]
	fn keeps_a_nav_inside_main_and_drops_one_inside_a_header() {
		let (instances, remainder) =
			run("<body><header><nav>a</nav></header><main><nav>b</nav></main></body>");
		assert_eq!(
			instances,
			vec![
				(
					LandmarkType::Header,
					"<header><nav>a</nav></header>".to_owned()
				),
				(LandmarkType::Nav, "<nav>b</nav>".to_owned()),
			]
		);
		assert_eq!(remainder, "<body><main></main></body>");
	}

	#[test]
	fn records_one_element_under_both_of_its_types() {
		let (instances, _) = run("<body><header role=\"navigation\">x</header></body>");
		assert_eq!(
			instances.iter().map(|(kind, _)| *kind).collect::<Vec<_>>(),
			vec![LandmarkType::Header, LandmarkType::Nav]
		);
	}

	#[test]
	fn matches_roles_and_ignores_unconfirmed_closes() {
		let (instances, remainder) =
			run("<body><div role=\"contentinfo\">f</div><aside>never closed</body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Footer,
				"<div role=\"contentinfo\">f</div>".to_owned()
			)]
		);
		assert_eq!(remainder, "<body><aside>never closed</body>");
	}
}
