use std::ops::Range;

use nitpicker_html_parser::{Document, EventKind, NONE};

/// The event ranges of `document` (parsed from `html`) that cutting `spans`
/// (ascending, disjoint) out of `html` would remove — or `None` when cutting
/// the markup and dropping those events might not give the same parse.
///
/// They agree when each span is exactly one element's markup — its opening
/// tag's own `<` starts the span (not merely its `startIndex`, which after
/// `</x >` points into markup htmlparser2 skipped), its own explicit closing
/// tag `</x>` ends it — and
/// the element neither closed anything outside itself on the way in (an
/// implied close) nor lost its close to an outer one. htmlparser2's state
/// after such a span (open-element stack, foreign context, tokenizer state)
/// is then what it was before it, so the markup that follows parses the
/// same with or without it. The one context the span can still change is
/// the character before it: `<` + `<x>…</x>` + `p>` would, once cut, read
/// `<p>`. Indices after the span shift, which only matters inside an opaque
/// element's hashed content; the replay refuses that case itself.
#[must_use]
pub fn skip_ranges(
	html: &str,
	document: &Document,
	spans: &[Range<usize>],
) -> Option<Vec<(u32, u32)>> {
	let bytes = html.as_bytes();
	let events = &document.events;
	let mut ranges = Vec::with_capacity(spans.len());
	for span in spans {
		let first = events.partition_point(|event| event.pos < span.start);
		let open = events.get(first)?;
		if open.kind != EventKind::Open || open.tag_start != span.start || open.partner == NONE {
			return None;
		}
		if span.start > 0 && bytes[span.start - 1] == b'<' {
			return None;
		}
		let close_index = open.partner as usize;
		let close = &events[close_index];
		if close.kind != (EventKind::Close { implied: false }) || close.pos + 1 != span.end {
			return None;
		}
		if events
			.get(close_index + 1)
			.is_some_and(|next| next.pos < span.end)
		{
			return None;
		}
		ranges.push((u32::try_from(first).ok()?, open.partner));
	}
	Some(ranges)
}

#[cfg(test)]
mod tests {
	use super::skip_ranges;

	fn ranges(html: &str, spans: &[std::ops::Range<usize>]) -> Option<Vec<(u32, u32)>> {
		let document = nitpicker_html_parser::parse(html);
		skip_ranges(html, &document, spans)
	}

	#[test]
	fn maps_whole_elements_to_their_events() {
		// Events: 0 body, 1 div, 2 p, 3 /p, 4 /div, 5 /body.
		let html = "<body><div><p>x</p></div></body>";
		assert_eq!(
			ranges(html, std::slice::from_ref(&(11..19))),
			Some(vec![(2, 3)])
		);
	}

	#[test]
	fn refuses_an_element_that_closed_a_paragraph_on_entry() {
		let html = "<body><p>a<div>b</div></body>";
		assert_eq!(ranges(html, std::slice::from_ref(&(10..22))), None);
	}

	#[test]
	fn refuses_a_span_after_a_stray_less_than_sign() {
		let html = "<body>a<<b>x</b>p></body>";
		assert_eq!(ranges(html, std::slice::from_ref(&(8..16))), None);
	}

	#[test]
	fn refuses_a_span_starting_at_skipped_markup() {
		// `</i ` swallows `</b>` up to its `>`, so <a>'s start index — and the
		// span a fragment parse reports — is the `<` of `</b>`; cutting from
		// there would leave `</i ` to swallow whatever follows instead.
		let html = "<body><b><i></i </b><a>x</a>t</b></body>";
		assert_eq!(ranges(html, std::slice::from_ref(&(16..28))), None);
	}

	#[test]
	fn refuses_a_span_not_ending_in_its_own_closing_tag() {
		let html = "<body><ul><li>a<li>b</ul></body>";
		assert_eq!(ranges(html, std::slice::from_ref(&(10..15))), None);
	}
}
