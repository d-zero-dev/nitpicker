/// Whether JavaScript's `\s` (and `String.prototype.trim`) takes `character`
/// for whitespace: the ASCII whitespace, the no-break and other Unicode
/// space separators, the line and paragraph separators, and the byte order
/// mark. (Not U+0085, which Rust's `char::is_whitespace` takes.)
fn is_js_whitespace(character: char) -> bool {
	matches!(
		character,
		'\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
			..='\u{200a}'
				| '\u{2028}' | '\u{2029}'
				| '\u{202f}' | '\u{205f}'
				| '\u{3000}' | '\u{feff}'
	)
}

/// The window of `snippet_length` characters centred on a match, cut from the
/// document after every run of whitespace is collapsed to one space (and its
/// ends trimmed), so the snippet is as long as asked however deep the markup
/// is indented.
///
/// `match_start` and `match_end` are byte offsets of the first match in
/// `text`. Positions and lengths are in Unicode scalar values of the
/// collapsed document: the window starts `snippet_length / 2` characters
/// before the match's middle, clamped to the document's start, and the result
/// is trimmed again where the window ends in a space.
///
/// # Panics
///
/// If `match_start..match_end` is not a range of `text` on character
/// boundaries.
#[must_use]
pub fn build_snippet(
	text: &str,
	match_start: usize,
	match_end: usize,
	snippet_length: usize,
) -> String {
	assert!(
		text.is_char_boundary(match_start) && text.is_char_boundary(match_end),
		"the match must be on character boundaries"
	);
	let mut collapsed = String::with_capacity(text.len());
	let mut collapsed_length = 0_usize;
	let mut pending_space = false;
	let mut start_in_collapsed = None;
	let mut end_in_collapsed = None;
	for (byte, character) in text.char_indices() {
		if byte == match_start {
			start_in_collapsed = Some(collapsed_length + usize::from(pending_space));
		}
		if byte == match_end {
			end_in_collapsed = Some(collapsed_length + usize::from(pending_space));
		}
		if is_js_whitespace(character) {
			pending_space = collapsed_length > 0;
		} else {
			if pending_space {
				collapsed.push(' ');
				collapsed_length += 1;
				pending_space = false;
			}
			collapsed.push(character);
			collapsed_length += 1;
		}
	}
	// A match that ends (or an empty match that sits) at the end of the text.
	let start = start_in_collapsed.unwrap_or(collapsed_length);
	let end = end_in_collapsed.unwrap_or(collapsed_length).max(start);
	let window_start = (start + (end - start) / 2).saturating_sub(snippet_length / 2);
	collapsed
		.chars()
		.skip(window_start)
		.take(snippet_length)
		.collect::<String>()
		.trim_matches(' ')
		.to_owned()
}

#[cfg(test)]
mod tests {
	use super::build_snippet;

	#[test]
	fn centres_the_window_on_the_match() {
		let text = "0123456789abcdefghij";
		// The match "abcd" (10..14) has its middle at 12; a window of 6 starts at 9.
		assert_eq!(build_snippet(text, 10, 14, 6), "9abcde");
	}

	#[test]
	fn starts_at_the_beginning_when_the_match_is_near_it() {
		assert_eq!(build_snippet("abcdef", 1, 2, 100), "abcdef");
	}

	#[test]
	fn collapses_whitespace_and_trims_the_ends() {
		let text = "  a \n\t b\u{a0}\u{2028}c  ";
		assert_eq!(build_snippet(text, 2, 3, 100), "a b c");
	}

	#[test]
	fn does_not_take_u0085_for_whitespace() {
		assert_eq!(build_snippet("a\u{85}b", 0, 1, 100), "a\u{85}b");
	}

	#[test]
	fn measures_in_scalar_values_not_bytes() {
		let text = "あいうえお😀かきくけこ";
		// The match "え" is character 3; a window of 4 starts at 3 - 2 = 1.
		let start = text.find('え').unwrap();
		assert_eq!(
			build_snippet(text, start, start + 'え'.len_utf8(), 4),
			"いうえお"
		);
		let emoji = text.find('😀').unwrap();
		assert_eq!(build_snippet(text, emoji, emoji + 4, 3), "お😀か");
	}

	#[test]
	fn a_match_longer_than_the_window_is_cut_around_its_middle() {
		// The match is characters 2..12, its middle is 7, and a window of 4 starts at 5.
		assert_eq!(build_snippet("..0123456789..", 2, 12, 4), "3456");
	}

	#[test]
	fn deep_indentation_does_not_shorten_the_snippet() {
		let text = format!(
			"<ul>\n{}<li>one</li>\n{}<li>two</li>\n</ul>",
			" ".repeat(40),
			" ".repeat(40)
		);
		let start = text.find("one").unwrap();
		// Collapsed: "<ul> <li>one</li> <li>two</li> </ul>"; "one" is characters 9..12,
		// the middle is 10 and a window of 20 starts at 0.
		assert_eq!(
			build_snippet(&text, start, start + 3, 20),
			"<ul> <li>one</li> <l"
		);
	}

	#[test]
	fn a_zero_length_window_is_empty() {
		assert_eq!(build_snippet("abc", 0, 1, 0), "");
	}
}
