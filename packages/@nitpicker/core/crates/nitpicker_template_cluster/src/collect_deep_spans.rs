use std::ops::Range;

use nitpicker_html_parser::{EventKind, TagName, parse};

use crate::is_genuine_close::is_genuine_close;

fn is_opaque(name: TagName) -> bool {
	matches!(
		name,
		TagName::SCRIPT | TagName::STYLE | TagName::NOSCRIPT | TagName::SVG
	)
}

/// One depth's walk state.
struct Walk {
	max_depth: usize,
	depth: usize,
	opaque: Option<(TagName, u32)>,
	capped: Option<(TagName, u32)>,
	/// `(start, end)`; `end` is `None` until the capped element closes.
	spans: Vec<(usize, Option<usize>)>,
}

/// For each of `max_depths`, the spans to cut from `html` so that inside
/// `content` (a content root's content) at most that many levels of
/// elements remain — the content root's own children being level 1.
///
/// The content is parsed on its own, as a fragment, and each too-deep
/// element is cut whole once it opens: nothing inside a cut needs its own
/// depth checked. "Whole" is decided like the rest of this classifier's
/// spans — by counting opening and closing tags of the capped element's
/// name — and a cut whose closing tag cannot be confirmed (see
/// `is_genuine_close`) is dropped, leaving that element in place rather than
/// risking a cut that runs into the markup after it. Opaque elements
/// (`script` / `style` / `noscript` / `svg`) are never cut themselves and add
/// no level. One parse serves every depth.
#[must_use]
pub fn collect_deep_spans(
	html: &str,
	content: Range<usize>,
	max_depths: &[usize],
) -> Vec<Vec<Range<usize>>> {
	let mut walks: Vec<Walk> = max_depths
		.iter()
		.map(|&max_depth| Walk {
			max_depth,
			depth: 0,
			opaque: None,
			capped: None,
			spans: Vec::new(),
		})
		.collect();
	if content.end > content.start {
		let offset = content.start;
		let fragment = parse(&html[content]);
		for event in &fragment.events {
			for walk in &mut walks {
				match event.kind {
					EventKind::Open => {
						if let Some((name, depth)) = walk.opaque.as_mut() {
							if event.name == *name {
								*depth += 1;
							}
							continue;
						}
						if let Some((name, depth)) = walk.capped.as_mut() {
							if event.name == *name {
								*depth += 1;
							}
							continue;
						}
						if is_opaque(event.name) {
							walk.opaque = Some((event.name, 1));
							continue;
						}
						if walk.depth + 1 > walk.max_depth {
							walk.capped = Some((event.name, 1));
							walk.spans.push((offset + event.start_index, None));
							continue;
						}
						walk.depth += 1;
					}
					EventKind::Close { .. } => {
						if let Some((name, depth)) = walk.opaque.as_mut() {
							if event.name == *name {
								*depth -= 1;
								if *depth == 0 {
									walk.opaque = None;
								}
							}
							continue;
						}
						if let Some((name, depth)) = walk.capped.as_mut() {
							if event.name == *name {
								*depth -= 1;
								if *depth == 0 {
									let end = offset + event.end_index + 1;
									let genuine =
										is_genuine_close(html, end, fragment.tag_name(event.name));
									if let Some(open) = walk.spans.last_mut() {
										open.1 = Some(if genuine { end } else { open.0 });
									}
									walk.capped = None;
								}
							}
							continue;
						}
						walk.depth = walk.depth.saturating_sub(1);
					}
				}
			}
		}
	}
	walks
		.into_iter()
		.map(|walk| {
			walk.spans
				.into_iter()
				.filter_map(|(start, end)| end.filter(|&end| end > start).map(|end| start..end))
				.collect()
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::collect_deep_spans;
	use crate::content_root::find_content_root;
	use crate::excise::excise;

	/// `html` capped at `depth` inside the page's own content root (the
	/// shallowest `<main>` / `role="main"` here); unchanged without one.
	fn capped_at_root(html: &str, depth: usize) -> String {
		let document = nitpicker_html_parser::parse(html);
		match find_content_root(html, &document, None) {
			Some(content) => {
				let spans = collect_deep_spans(html, content, &[depth]).remove(0);
				excise(html, &spans)
			}
			None => html.to_owned(),
		}
	}

	fn capped(html: &str, depth: usize) -> String {
		let content = html.find("<main>").unwrap() + 6..html.rfind("</main>").unwrap();
		let spans = collect_deep_spans(html, content, &[depth]).remove(0);
		excise(html, &spans)
	}

	#[test]
	fn keeps_the_given_number_of_levels() {
		let html = "<body><main><div><div><div><div>too deep</div></div></div></div></main></body>";
		assert_eq!(
			capped(html, 2),
			"<body><main><div><div></div></div></main></body>"
		);
		assert_eq!(capped(html, 0), "<body><main></main></body>");
	}

	#[test]
	fn neither_cuts_nor_counts_opaque_elements() {
		let html = "<body><main><svg><g><g></g></g></svg><p><b>x</b></p></main></body>";
		assert_eq!(
			capped(html, 1),
			"<body><main><svg><g><g></g></g></svg><p></p></main></body>"
		);
	}

	#[test]
	fn leaves_an_element_whose_close_is_only_implied() {
		let html = "<body><main><ul><li><b>a<li>b</ul></main></body>";
		assert_eq!(capped(html, 1), html);
	}

	#[test]
	fn computes_several_depths_from_one_parse() {
		let html = "<body><main><div><p><b>x</b></p></div></main></body>";
		let content = 12..html.rfind("</main>").unwrap();
		let spans = collect_deep_spans(html, content, &[1, 2, 3]);
		// <p> spans 17..32, <b> spans 20..28.
		assert_eq!(spans, vec![vec![17..32], vec![20..28], vec![]]);
	}

	#[test]
	fn leaves_content_shallower_than_the_cap_unchanged() {
		let html = "<body><main><div><p>shallow</p></div></main></body>";
		assert_eq!(capped_at_root(html, 3), html);
	}

	#[test]
	fn anchors_on_a_role_main_element_without_a_main_tag() {
		let html = "<body><div role=\"main\"><div><div><div>deep</div></div></div></div></body>";
		assert_eq!(
			capped_at_root(html, 1),
			"<body><div role=\"main\"><div></div></div></body>"
		);
	}

	#[test]
	fn leaves_a_page_without_a_content_root_unchanged() {
		let html = "<body><p>no main here</p></body>";
		assert_eq!(capped_at_root(html, 1), html);
	}

	#[test]
	fn keeps_the_root_element_and_its_attributes_even_at_depth_zero() {
		assert_eq!(
			capped_at_root(
				"<body><main class=\"detail\"><div>content</div></main></body>",
				0
			),
			"<body><main class=\"detail\"></main></body>"
		);
	}

	#[test]
	fn caps_each_independent_too_deep_branch() {
		let html = "<body><main><section><div><div>deep-a</div></div></section><section><div><div>deep-b</div></div></section></main></body>";
		assert_eq!(
			capped_at_root(html, 2),
			"<body><main><section><div></div></section><section><div></div></section></main></body>"
		);
	}

	#[test]
	fn caps_inside_the_shallowest_of_several_main_elements() {
		// The second <main> (a direct child of body) is shallower than the
		// first (nested in a <div>), so it is the one capped.
		let html = "<body><div><main><div><div><div>deep</div></div></div></main></div><main><div><div><div>also-deep</div></div></div></main></body>";
		assert_eq!(
			capped_at_root(html, 1),
			"<body><div><main><div><div><div>deep</div></div></div></main></div><main><div></div></main></body>"
		);
	}

	#[test]
	fn never_counts_or_cuts_the_inside_of_a_script() {
		let html = "<body><main><div><script>var deep = { a: { b: { c: 1 } } };</script></div></main></body>";
		assert_eq!(capped_at_root(html, 1), html);
	}

	#[test]
	fn leaves_an_unclosed_too_deep_element_in_place() {
		// No closing </div> before </main>: the parser closes the element
		// where no real closing tag for it exists, so the cut is dropped.
		let html = "<body><main><div><div>unclosed</main></body>";
		assert_eq!(capped_at_root(html, 1), html);
	}
}
