use std::ops::Range;

/// `html` with `spans` cut out (merged first, so nested or overlapping
/// spans are fine). Nothing is left in a span's place: a placeholder would
/// itself become a token.
#[must_use]
pub fn excise(html: &str, spans: &[Range<usize>]) -> String {
	if spans.is_empty() {
		return html.to_owned();
	}
	let mut sorted = spans.to_vec();
	sorted.sort_by_key(|span| span.start);
	let mut merged: Vec<Range<usize>> = Vec::with_capacity(sorted.len());
	for span in sorted {
		match merged.last_mut() {
			Some(last) if span.start <= last.end => last.end = last.end.max(span.end),
			_ => merged.push(span),
		}
	}
	let mut remainder = String::with_capacity(html.len());
	let mut cursor = 0;
	for span in merged {
		remainder.push_str(&html[cursor..span.start.max(cursor)]);
		cursor = cursor.max(span.end);
	}
	remainder.push_str(&html[cursor.min(html.len())..]);
	remainder
}

#[cfg(test)]
mod tests {
	use super::excise;

	#[test]
	fn cuts_merged_spans_without_a_placeholder() {
		assert_eq!(excise("0123456789", &[5..7, 1..3, 2..4]), "04789");
		assert_eq!(excise("abc", &[]), "abc");
		assert_eq!(excise("abc", std::slice::from_ref(&(0..3))), "");
	}
}
