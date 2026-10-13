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
	use std::fmt::Write;

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

	fn of(instances: &[(LandmarkType, String)], kind: LandmarkType) -> Vec<&str> {
		instances
			.iter()
			.filter(|(found, _)| *found == kind)
			.map(|(_, html)| html.as_str())
			.collect()
	}

	#[test]
	fn cuts_out_a_nav_like_a_header_or_footer() {
		let (instances, remainder) = run("<body><nav>N</nav><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(LandmarkType::Nav, "<nav>N</nav>".to_owned())]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn cuts_out_an_aside_like_a_header_or_footer() {
		let (instances, remainder) = run("<body><aside>A</aside><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(LandmarkType::Aside, "<aside>A</aside>".to_owned())]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn cuts_out_a_search_element_as_the_search_landmark() {
		let (instances, remainder) =
			run("<body><search><input type=\"search\"/></search><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Search,
				"<search><input type=\"search\"/></search>".to_owned()
			)]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn treats_role_form_as_a_landmark_but_not_a_bare_form() {
		let (instances, remainder) =
			run("<body><form role=\"form\"><input/></form><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Form,
				"<form role=\"form\"><input/></form>".to_owned()
			)]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");

		let (instances, remainder) = run("<body><form><input/></form><main>M</main></body>");
		assert!(instances.is_empty());
		assert_eq!(
			remainder,
			"<body><form><input/></form><main>M</main></body>"
		);
	}

	#[test]
	fn treats_role_search_on_a_form_as_the_search_landmark() {
		let (instances, remainder) =
			run("<body><form role=\"search\"><input/></form><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Search,
				"<form role=\"search\"><input/></form>".to_owned()
			)]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn leaves_a_page_without_landmarks_unchanged() {
		let html = "<body>only content</body>";
		assert_eq!(run(html), (vec![], html.to_owned()));
	}

	#[test]
	fn leaves_a_page_without_body_unchanged() {
		let html = "<html><head><title>x</title></head></html>";
		assert_eq!(run(html), (vec![], html.to_owned()));
	}

	#[test]
	fn treats_role_banner_as_a_header_without_a_header_tag() {
		let (instances, _) = run("<body><div role=\"banner\">H</div><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Header,
				"<div role=\"banner\">H</div>".to_owned()
			)]
		);
	}

	#[test]
	fn cuts_an_element_matching_tag_and_role_out_once() {
		let (instances, remainder) =
			run("<body><header role=\"navigation\">HN</header><main>M</main></body>");
		assert_eq!(
			of(&instances, LandmarkType::Header),
			vec!["<header role=\"navigation\">HN</header>"]
		);
		assert_eq!(
			of(&instances, LandmarkType::Nav),
			vec!["<header role=\"navigation\">HN</header>"]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn recognizes_role_banner_on_the_body_itself() {
		let html = "<body role=\"banner\"><main>M</main></body>";
		let (instances, remainder) = run(html);
		assert_eq!(instances, vec![(LandmarkType::Header, html.to_owned())]);
		assert_eq!(remainder, "");
	}

	#[test]
	fn collects_every_non_nested_header_in_document_order() {
		let (instances, remainder) = run(
			"<body><main><article><header>Article H</header></article></main><header>Site H</header></body>",
		);
		assert_eq!(
			of(&instances, LandmarkType::Header),
			vec!["<header>Article H</header>", "<header>Site H</header>"]
		);
		assert_eq!(remainder, "<body><main><article></article></main></body>");
	}

	#[test]
	fn keeps_every_one_of_eleven_headers() {
		let mut siblings = String::new();
		for index in 0..10 {
			write!(siblings, "<header>sibling-{index}</header>").unwrap();
		}
		let html = format!("<body><header>outer</header>{siblings}</body>");
		let (instances, _) = run(&html);
		let headers = of(&instances, LandmarkType::Header);
		assert_eq!(headers.len(), 11);
		assert_eq!(headers[0], "<header>outer</header>");
		assert_eq!(headers[10], "<header>sibling-9</header>");
	}

	#[test]
	fn drops_a_nav_strictly_inside_a_header() {
		let (instances, remainder) =
			run("<body><header>H<nav>N</nav>after-nav</header><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Header,
				"<header>H<nav>N</nav>after-nav</header>".to_owned()
			)]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn cuts_a_header_and_a_footer_with_a_nav_nested_only_in_the_footer() {
		let (instances, remainder) =
			run("<body><header>H</header><main>M</main><footer>F<nav>N</nav></footer></body>");
		assert_eq!(
			instances,
			vec![
				(LandmarkType::Header, "<header>H</header>".to_owned()),
				(
					LandmarkType::Footer,
					"<footer>F<nav>N</nav></footer>".to_owned()
				),
			]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn never_cuts_main_out_of_the_remainder() {
		let (_, remainder) =
			run("<body><header>H</header><main>content</main><footer>F</footer></body>");
		assert_eq!(remainder, "<body><main>content</main></body>");
	}

	#[test]
	fn extracts_a_section_local_nav_inside_main() {
		let (instances, remainder) = run(concat!(
			"<body><nav>global</nav>",
			"<main><nav class=\"local\">local menu</nav><article>body</article></main></body>"
		));
		assert_eq!(
			of(&instances, LandmarkType::Nav),
			vec!["<nav>global</nav>", "<nav class=\"local\">local menu</nav>"]
		);
		assert_eq!(
			remainder,
			"<body><main><article>body</article></main></body>"
		);
	}

	#[test]
	fn cuts_a_main_nested_inside_a_landmark_out_with_it() {
		let (instances, remainder) = run("<body><header>H<main>M</main></header></body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Header,
				"<header>H<main>M</main></header>".to_owned()
			)]
		);
		assert_eq!(remainder, "<body></body>");
	}

	#[test]
	fn removing_a_landmark_leaves_its_sibling_wrapper_in_the_remainder() {
		let (_, remainder) = run("<body><div><header>H</header><main>content</main></div></body>");
		assert_eq!(remainder, "<body><div><main>content</main></div></body>");
	}

	#[test]
	fn leaves_only_content_in_the_remainder_after_cutting_all_chrome() {
		let (instances, remainder) = run(concat!(
			"<body><header class=\"site-header\"><nav class=\"site-nav\"><a href=\"/\">Home</a></nav></header>",
			"<main><article><h1>Title</h1><p>Body text</p></article></main>",
			"<footer class=\"site-footer\"><p>Copyright</p></footer></body>"
		));
		assert_eq!(
			instances.iter().map(|(kind, _)| *kind).collect::<Vec<_>>(),
			vec![LandmarkType::Header, LandmarkType::Footer]
		);
		assert_eq!(
			remainder,
			"<body><main><article><h1>Title</h1><p>Body text</p></article></main></body>"
		);
	}

	#[test]
	fn ignores_a_landmark_tag_inside_svg() {
		let html = "<body><svg><header>fake</header></svg><main>M</main></body>";
		assert_eq!(run(html), (vec![], html.to_owned()));
	}

	#[test]
	fn finds_a_header_after_a_self_nested_svg() {
		let (instances, remainder) =
			run("<body><svg><svg></svg></svg><header>H</header><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(LandmarkType::Header, "<header>H</header>".to_owned())]
		);
		assert_eq!(
			remainder,
			"<body><svg><svg></svg></svg><main>M</main></body>"
		);
	}

	#[test]
	fn is_unaffected_by_stray_nested_body_tags() {
		let html = concat!(
			"<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n",
			"<title>Nested Body Tags Malformed</title>\n</head>\n<body>\n<header>\n",
			"<p id=\"marker-nested-body-tags-malformed\" data-marker=\"nested-body-tags-malformed\">MARKER_NESTED_BODY_TAGS_MALFORMED</p>\n",
			"</header>\n<body class=\"second-body\">\n",
			"<p>Content after an illegal second &lt;body&gt; start tag.</p>\n",
			"<body class=\"third-body\">\n",
			"<p>Content after an illegal third &lt;body&gt; start tag, still nested in source.</p>\n",
			"</body>\n",
			"<p>Content after a stray &lt;/body&gt; close tag that should not actually end the document.</p>\n",
			"</body>\n<main>\n",
			"<p>Main content that appears after multiple malformed body tags.</p>\n",
			"</main>\n</body>\n</html>\n"
		);
		let (instances, remainder) = run(html);
		assert!(
			of(&instances, LandmarkType::Header)
				.concat()
				.contains("MARKER_NESTED_BODY_TAGS_MALFORMED")
		);
		assert!(!remainder.contains("MARKER_NESTED_BODY_TAGS_MALFORMED"));
		assert!(
			remainder.contains("Main content that appears after multiple malformed body tags.")
		);
	}

	#[test]
	fn discards_an_unclosed_landmark_instead_of_swallowing_the_rest() {
		let html = "<body><header>H<main><article>Real content</article></main></body>";
		assert_eq!(run(html), (vec![], html.to_owned()));
	}

	#[test]
	fn discards_a_self_closed_non_void_landmark() {
		let html = "<body><header/>Real content here</body>";
		assert_eq!(run(html), (vec![], html.to_owned()));
	}

	#[test]
	fn handles_a_role_bearing_tag_name_with_regex_metacharacters() {
		let (instances, remainder) =
			run("<body><div(foo role=\"banner\">H</div(foo><main>M</main></body>");
		assert_eq!(
			instances,
			vec![(
				LandmarkType::Header,
				"<div(foo role=\"banner\">H</div(foo>".to_owned()
			)]
		);
		assert_eq!(remainder, "<body><main>M</main></body>");
	}

	#[test]
	fn keeps_a_well_formed_header_inside_a_discarded_malformed_one() {
		let (instances, remainder) =
			run("<body><header>Outer malformed<main><header>Inner OK</header></main></body>");
		assert_eq!(
			instances,
			vec![(LandmarkType::Header, "<header>Inner OK</header>".to_owned())]
		);
		assert_eq!(
			remainder,
			"<body><header>Outer malformed<main></main></body>"
		);
	}
}
