/// JavaScript's case-insensitive comparison of one UTF-16 unit without the
/// `u` flag (`Canonicalize`): upper-case it when that yields one unit, but
/// never turn a non-ASCII character into an ASCII one.
fn canonicalize(c: char) -> char {
	let mut upper = c.to_uppercase();
	match (upper.next(), upper.next()) {
		(Some(upper), None) if !(u32::from(c) >= 128 && u32::from(upper) < 128) => upper,
		_ => c,
	}
}

/// Whether `html` holds a literal closing tag for `tag_name` ending right at
/// `end_offset`.
///
/// htmlparser2 also reports the closes it implies (an unclosed `<header>`
/// closed by `</body>`), at whatever position the tag that forced them sits;
/// trusting such a position would cut a span reaching that unrelated tag.
/// The check is JavaScript's ``new RegExp(`</\s*${tag}\s*>$`, 'i')`` over the
/// last `tag.length + 3` UTF-16 units — a window with no room for the
/// whitespace the pattern allows, so in effect it matches exactly
/// `</tag>`, case-insensitively.
#[must_use]
pub fn is_genuine_close(html: &str, end_offset: usize, tag_name: &str) -> bool {
	let Some(before) = html.get(..end_offset) else {
		return false;
	};
	if tag_name.is_ascii() {
		let window = tag_name.len() + 3;
		let bytes = before.as_bytes();
		if bytes.len() < window {
			return false;
		}
		let window = &bytes[bytes.len() - window..];
		return window.starts_with(b"</")
			&& window.ends_with(b">")
			&& window[2..window.len() - 1].eq_ignore_ascii_case(tag_name.as_bytes());
	}

	let expected: Vec<char> = format!("</{tag_name}>").chars().collect();
	let units: usize = expected.iter().map(|c| c.len_utf16()).sum();
	let mut actual: Vec<char> = Vec::new();
	let mut taken = 0;
	for c in before.chars().rev() {
		if taken >= units {
			break;
		}
		taken += c.len_utf16();
		actual.push(c);
	}
	if taken != units {
		return false;
	}
	actual.reverse();
	actual.len() == expected.len()
		&& actual
			.iter()
			.zip(&expected)
			.all(|(&a, &e)| canonicalize(a) == canonicalize(e))
}

#[cfg(test)]
mod tests {
	use super::is_genuine_close;

	#[test]
	fn accepts_a_literal_closing_tag_in_any_case() {
		assert!(is_genuine_close("<header>H</header>", 18, "header"));
		assert!(is_genuine_close("<header>H</HEADER>", 18, "header"));
	}

	#[test]
	fn rejects_an_implied_close_reported_at_another_tag() {
		assert!(!is_genuine_close("<header>H</body>", 16, "header"));
		assert!(!is_genuine_close("<header>H</main></body>", 23, "header"));
	}

	#[test]
	fn rejects_whitespace_the_window_has_no_room_for() {
		assert!(!is_genuine_close("<p></p >", 8, "p"));
	}

	#[test]
	fn rejects_a_window_running_past_the_start() {
		assert!(!is_genuine_close("/p>", 3, "p"));
	}

	#[test]
	fn compares_non_ascii_names_by_utf16_units() {
		assert!(is_genuine_close("<x-\u{e9}></x-\u{c9}>", 13, "x-\u{e9}"));
		assert!(!is_genuine_close("<x-\u{e9}></x-e>", 12, "x-\u{e9}"));
	}

	#[test]
	fn accepts_a_tag_name_with_regex_metacharacters() {
		assert!(is_genuine_close("<div(foo></div(foo>", 19, "div(foo"));
		assert!(!is_genuine_close("<div(foo>H</body>", 17, "div(foo"));
	}
}
