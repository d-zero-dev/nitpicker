/// Longest evidence kept, in UTF-16 code units — the unit of JS
/// `String.prototype.slice`, which cut the stored evidence.
pub const EVIDENCE_MAX_UTF16_UNITS: usize = 200;

/// Cuts a matched span to its first [`EVIDENCE_MAX_UTF16_UNITS`] UTF-16 code
/// units, as `match[0].slice(0, 200)` did in JS.
///
/// When the cut falls between the two halves of a surrogate pair, JS kept a
/// lone high surrogate, which became U+FFFD once written to SQLite as UTF-8;
/// this returns U+FFFD in its place, the value the archive holds. Bytes that
/// are not valid UTF-8 (possible only in a JS resource cut at a byte limit)
/// decode to U+FFFD, as `Buffer.prototype.toString('utf8')` decodes them.
#[must_use]
pub fn truncate_evidence(matched: &[u8]) -> String {
	let text = String::from_utf8_lossy(matched);
	let mut units = 0;
	let mut out = String::with_capacity(text.len().min(EVIDENCE_MAX_UTF16_UNITS * 3));
	for character in text.chars() {
		let width = character.len_utf16();
		if units + width > EVIDENCE_MAX_UTF16_UNITS {
			if units < EVIDENCE_MAX_UTF16_UNITS {
				out.push(char::REPLACEMENT_CHARACTER);
			}
			break;
		}
		units += width;
		out.push(character);
	}
	out
}

#[cfg(test)]
mod tests {
	use super::{EVIDENCE_MAX_UTF16_UNITS, truncate_evidence};

	#[test]
	fn keeps_a_short_span_whole() {
		assert_eq!(truncate_evidence(b"<div id=\"app\""), "<div id=\"app\"");
	}

	#[test]
	fn cuts_ascii_at_two_hundred_characters() {
		let span = "a".repeat(250);
		assert_eq!(
			truncate_evidence(span.as_bytes()),
			"a".repeat(EVIDENCE_MAX_UTF16_UNITS)
		);
	}

	#[test]
	fn counts_a_bmp_character_as_one_unit() {
		let span = "日".repeat(250);
		assert_eq!(
			truncate_evidence(span.as_bytes()),
			"日".repeat(EVIDENCE_MAX_UTF16_UNITS)
		);
	}

	#[test]
	fn counts_an_astral_character_as_two_units() {
		let span = "😀".repeat(150);
		assert_eq!(truncate_evidence(span.as_bytes()), "😀".repeat(100));
	}

	#[test]
	fn replaces_a_surrogate_pair_split_by_the_cut() {
		let span = format!("{}😀tail", "a".repeat(199));
		assert_eq!(
			truncate_evidence(span.as_bytes()),
			format!("{}\u{FFFD}", "a".repeat(199))
		);
	}

	#[test]
	fn decodes_invalid_utf8_as_replacement_characters() {
		assert_eq!(truncate_evidence(b"ab\xE2\x80"), "ab\u{FFFD}");
	}
}
