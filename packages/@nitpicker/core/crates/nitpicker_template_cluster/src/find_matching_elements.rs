use nitpicker_html_parser::{Attributes, Document, EventKind, TagName};

use crate::is_genuine_close::is_genuine_close;

/// One genuinely closed element that matched a requested type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchingElement<T> {
	/// The type it matched.
	pub kind: T,
	/// Ancestors since `<body>` (0 for `<body>` itself).
	pub depth: usize,
	/// Where the element starts (htmlparser2's `startIndex` of its opening
	/// tag — which, after a closing tag written `</x >`, is that tag's `>`).
	pub start: usize,
	/// Just past its closing tag.
	pub end: usize,
	/// Just past the first `>` from `start` (`0` when there is none).
	pub content_start: usize,
	/// The last `<` before `end` (`None` when there is none).
	pub content_end: Option<usize>,
}

fn is_opaque(name: TagName) -> bool {
	matches!(
		name,
		TagName::SCRIPT | TagName::STYLE | TagName::NOSCRIPT | TagName::SVG
	)
}

struct Frame<T> {
	name: TagName,
	kinds: Vec<T>,
	start: usize,
}

/// Every genuinely closed element under the first `<body>` (outside opaque
/// elements) matching at least one type, one entry per type it matched,
/// ordered by start (closing order within a start). `match_kinds` receives
/// the tag name, the raw `role` (absent when empty) and the raw attributes —
/// the values htmlparser2 reports with `decodeEntities: false`.
pub fn find_matching_elements<T: Copy>(
	html: &str,
	document: &Document,
	mut match_kinds: impl FnMut(&str, Option<&str>, &Attributes) -> Vec<T>,
) -> Vec<MatchingElement<T>> {
	let mut stack: Vec<Frame<T>> = Vec::new();
	let mut matches: Vec<MatchingElement<T>> = Vec::new();
	let mut opaque: Option<(TagName, u32)> = None;
	let mut body_done = false;
	let mut ignored_body_opens = 0u32;

	let mut kinds_of = |event: &nitpicker_html_parser::Event| {
		let attributes = document.attributes_of(event);
		let role = attributes
			.role
			.as_ref()
			.map(|value| value.raw(html))
			.filter(|role| !role.is_empty());
		match_kinds(document.tag_name(event.name), role, attributes)
	};

	for event in &document.events {
		match event.kind {
			EventKind::Open => {
				if let Some((name, depth)) = opaque.as_mut() {
					if event.name == *name {
						*depth += 1;
					}
					continue;
				}
				if stack.is_empty() {
					if event.name == TagName::BODY && !body_done {
						stack.push(Frame {
							name: event.name,
							kinds: kinds_of(event),
							start: event.start_index,
						});
					}
					continue;
				}
				if event.name == TagName::BODY {
					ignored_body_opens += 1;
					continue;
				}
				if is_opaque(event.name) {
					opaque = Some((event.name, 1));
					continue;
				}
				stack.push(Frame {
					name: event.name,
					kinds: kinds_of(event),
					start: event.start_index,
				});
			}
			EventKind::Close { .. } => {
				if let Some((name, depth)) = opaque.as_mut() {
					if event.name == *name {
						*depth -= 1;
						if *depth == 0 {
							opaque = None;
						}
					}
					continue;
				}
				if event.name == TagName::BODY && ignored_body_opens > 0 {
					ignored_body_opens -= 1;
					continue;
				}
				let Some(frame) = stack.pop() else {
					continue;
				};
				let depth = stack.len();
				let end = event.end_index + 1;
				if !frame.kinds.is_empty()
					&& is_genuine_close(html, end, document.tag_name(frame.name))
				{
					let bytes = html.as_bytes();
					let content_start = bytes
						.get(frame.start..)
						.and_then(|rest| rest.iter().position(|&byte| byte == b'>'))
						.map_or(0, |offset| frame.start + offset + 1);
					let content_end = bytes[..end].iter().rposition(|&byte| byte == b'<');
					for &kind in &frame.kinds {
						matches.push(MatchingElement {
							kind,
							depth,
							start: frame.start,
							end,
							content_start,
							content_end,
						});
					}
				}
				if stack.is_empty() {
					body_done = true;
				}
			}
		}
	}

	matches.sort_by_key(|element| element.start);
	matches
}

#[cfg(test)]
mod tests {
	use super::find_matching_elements;

	fn spans(html: &str) -> Vec<(usize, usize, usize)> {
		let document = nitpicker_html_parser::parse(html);
		find_matching_elements(html, &document, |tag, _role, _attributes| {
			if tag == "nav" || tag == "header" {
				vec![tag.len()]
			} else {
				vec![]
			}
		})
		.into_iter()
		.map(|element| (element.start, element.end, element.depth))
		.collect()
	}

	#[test]
	fn reports_genuinely_closed_matches_in_start_order() {
		// header 6..35 at depth 1, nav 14..26 at depth 2.
		assert_eq!(
			spans("<body><header><nav>x</nav></header></body>"),
			vec![(6, 35, 1), (14, 26, 2)]
		);
	}

	#[test]
	fn drops_a_match_closed_only_by_implication() {
		assert_eq!(spans("<body><header><p>x</body>"), vec![]);
	}

	#[test]
	fn does_not_look_inside_opaque_elements() {
		assert_eq!(
			spans("<body><noscript><nav></nav></noscript></body>"),
			vec![]
		);
	}
}
