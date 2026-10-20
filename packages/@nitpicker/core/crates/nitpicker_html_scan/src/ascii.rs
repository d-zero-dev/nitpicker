//! The ASCII classes HTML start tags are read with.

/// Whether `byte` is one of the five ASCII whitespace characters HTML
/// separates attributes with: space, tab, line feed, form feed, carriage
/// return. (Not vertical tab.)
#[must_use]
pub fn is_html_space(byte: u8) -> bool {
	matches!(byte, b' ' | b'\t' | b'\n' | 0x0c | b'\r')
}

#[cfg(test)]
mod tests {
	use super::is_html_space;

	#[test]
	fn knows_the_five_whitespace_characters_and_not_vertical_tab() {
		for byte in [b' ', b'\t', b'\n', 0x0c, b'\r'] {
			assert!(is_html_space(byte));
		}
		assert!(!is_html_space(0x0b));
		assert!(!is_html_space(b'a'));
		assert!(!is_html_space(0xa0));
	}
}
