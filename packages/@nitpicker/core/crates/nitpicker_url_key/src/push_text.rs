use crate::decode_uri::decode_uri;

/// Where a digit run sorts among the other characters: exactly where `'0'`
/// would, so `a-1` < `a1` < `ab` as plain text order puts them.
const DIGIT_RUN_MARKER: [u8; 2] = [0x00, 0x30];

/// Appends `text` to `out` as bytes whose `memcmp` order is the sort order of
/// the text, followed by a terminator that sorts before everything else (a
/// text that is a prefix of another sorts first).
///
/// The text is percent-decoded like `decodeURI` (undecodable text stays as
/// written), lowercased, then written as UTF-16 code units, big-endian, so
/// the byte order is JavaScript's string order (a supplementary character
/// sorts before U+E000..U+FFFF, which UTF-8 would not give). NUL characters
/// are dropped: the terminator is a NUL unit.
///
/// With `numeric`, each run of ASCII digits is written as a marker, the
/// run's length (leading zeros removed) and the digits, so `2` < `10`. The
/// comparison reads the text left to right, run by run, and never parses a
/// number out of a mixed string, which keeps it a total order: `a1x` < `a9`
/// < `a10`. Parsing a number out of each pair would not (`a9` < `a10` <
/// `a1x` < `a9`), which is why the runs are encoded instead.
pub(crate) fn push_text(out: &mut Vec<u8>, text: &str, numeric: bool) {
	// Lowercased after decoding, so a decoded capital (`%41`) folds like a
	// written one.
	let lowered = decode_uri(text)
		.unwrap_or_else(|| text.to_owned())
		.to_lowercase();
	let mut chars = lowered.chars().peekable();
	while let Some(c) = chars.next() {
		if numeric && c.is_ascii_digit() {
			let mut digits = String::from(c);
			while let Some(next) = chars.next_if(char::is_ascii_digit) {
				digits.push(next);
			}
			let significant = digits.trim_start_matches('0');
			push_digit_run(out, significant, digits.len() - significant.len());
			continue;
		}
		let mut units = [0_u16; 2];
		for unit in c.encode_utf16(&mut units) {
			if *unit != 0 {
				out.extend_from_slice(&unit.to_be_bytes());
			}
		}
	}
	out.extend_from_slice(&[0x00, 0x00]);
}

/// Appends one digit run: the marker, the length and the digits without
/// leading zeros, then how many leading zeros there were. Equal values
/// therefore order as their digit strings do: `001` < `01` < `1` (more zeros
/// first, as `0` sorts before every other digit) and `0` < `00` (a run of
/// zeros alone: the shorter first).
fn push_digit_run(out: &mut Vec<u8>, digits: &str, leading_zeros: usize) {
	out.extend_from_slice(&DIGIT_RUN_MARKER);
	// A length below 255 is one byte; a longer run is 0xFF and four bytes.
	// Both keep the numeric order of the lengths under `memcmp`.
	match u8::try_from(digits.len()) {
		Ok(length) if length < 0xFF => out.push(length),
		_ => {
			out.push(0xFF);
			// A run longer than 4 GiB cannot occur in a URL held in memory.
			out.extend_from_slice(
				&u32::try_from(digits.len())
					.unwrap_or(u32::MAX)
					.to_be_bytes(),
			);
		}
	}
	out.extend_from_slice(digits.as_bytes());
	// 255 zeros or more tie; no URL is written that way.
	let zeros = u8::try_from(leading_zeros).unwrap_or(u8::MAX);
	out.push(if digits.is_empty() {
		zeros
	} else {
		u8::MAX - zeros
	});
}

#[cfg(test)]
mod tests {
	use super::push_text;

	fn key(text: &str, numeric: bool) -> Vec<u8> {
		let mut out = Vec::new();
		push_text(&mut out, text, numeric);
		out
	}

	#[test]
	fn orders_digit_runs_by_value() {
		assert!(key("a9", true) < key("a10", true));
		assert!(key("a2", true) < key("a10", true));
		// The trio a pairwise comparison by parsed numbers cannot order consistently.
		assert!(key("a1x", true) < key("a9", true));
		assert!(key("a9", true) < key("a10", true));
	}

	#[test]
	fn orders_equal_values_as_their_digit_strings_order() {
		assert!(key("a001", true) < key("a01", true));
		assert!(key("a01", true) < key("a1", true));
		assert!(key("a0", true) < key("a00", true));
		// The value decides first: more zeros do not make a smaller number larger.
		assert!(key("a1", true) < key("a002", true));
	}

	#[test]
	fn reads_digits_as_plain_characters_when_not_numeric() {
		assert!(key("a10", false) < key("a9", false));
	}

	#[test]
	fn places_a_digit_run_where_zero_sorts() {
		assert!(key("a-1", true) < key("a1", true));
		assert!(key("a1", true) < key("ab", true));
	}

	#[test]
	fn is_case_insensitive_and_decodes_escapes() {
		assert_eq!(key("ABC", true), key("abc", true));
		assert_eq!(key("%E3%81%82", false), key("あ", false));
		assert_eq!(key("a%42", true), key("ab", true));
		assert_eq!(key("%C3%89", false), key("é", false));
	}

	#[test]
	fn puts_a_prefix_before_its_extensions() {
		assert!(key("ab", true) < key("abc", true));
		assert!(key("", true) < key("a", true));
	}

	#[test]
	fn follows_utf16_order_for_supplementary_characters() {
		// U+1F600 is the surrogate pair D83D DE00, below U+FF21 in UTF-16.
		assert!(key("😀", false) < key("\u{ff41}", false));
	}

	#[test]
	fn drops_nul_so_the_terminator_stays_the_smallest() {
		assert_eq!(key("a%00b", false), key("ab", false));
	}

	#[test]
	fn orders_digit_runs_longer_than_a_byte_by_length() {
		let long = "1".repeat(300);
		let longer = "1".repeat(301);
		assert!(key(&format!("a{}", "9".repeat(254)), true) < key(&format!("a{long}"), true));
		assert!(key(&format!("a{long}"), true) < key(&format!("a{longer}"), true));
	}
}
