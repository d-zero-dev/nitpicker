//! JavaScript string semantics the stored classifier keys depend on: what `\s` / `trim()` treat as whitespace, how `<` orders strings
//! (UTF-16 code units), how `decodeURI` decodes, how `JSON.stringify` quotes.

use std::cmp::Ordering;
use std::fmt::Write as _;

/// `\s` in a JavaScript regular expression (and `String.prototype.trim`):
/// `WhiteSpace` plus `LineTerminator`.
#[must_use]
pub fn is_js_whitespace(c: char) -> bool {
	matches!(
		c,
		'\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
			..='\u{200A}'
				| '\u{2028}' | '\u{2029}'
				| '\u{202F}' | '\u{205F}'
				| '\u{3000}' | '\u{FEFF}'
	)
}

/// `value.trim()`.
#[must_use]
pub fn js_trim(value: &str) -> &str {
	value.trim_matches(is_js_whitespace)
}

/// `value.split(/\s+/).filter(Boolean)`.
pub fn js_split_whitespace(value: &str) -> impl Iterator<Item = &str> {
	value
		.split(is_js_whitespace)
		.filter(|part| !part.is_empty())
}

/// `a < b` / `a > b` on JavaScript strings: UTF-16 code-unit order, which
/// differs from UTF-8 byte order once a supplementary-plane character meets
/// one from U+E000–U+FFFF.
#[must_use]
pub fn compare_utf16(a: &str, b: &str) -> Ordering {
	a.encode_utf16().cmp(b.encode_utf16())
}

/// `JSON.stringify(value)` for a string.
#[must_use]
pub fn json_string(value: &str) -> String {
	let mut out = String::with_capacity(value.len() + 2);
	out.push('"');
	for c in value.chars() {
		match c {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\u{08}' => out.push_str("\\b"),
			'\u{0C}' => out.push_str("\\f"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			c if u32::from(c) < 0x20 => {
				let _ = write!(out, "\\u{:04x}", u32::from(c));
			}
			c => out.push(c),
		}
	}
	out.push('"');
	out
}

/// Characters `decodeURI` leaves percent-encoded.
const URI_RESERVED_AND_HASH: &[u8] = b";/?:@&=+$,#";

fn hex_value(byte: u8) -> Option<u8> {
	match byte {
		b'0'..=b'9' => Some(byte - b'0'),
		b'a'..=b'f' => Some(byte - b'a' + 10),
		b'A'..=b'F' => Some(byte - b'A' + 10),
		_ => None,
	}
}

/// The byte a `%XX` at `index` encodes.
fn percent_byte(bytes: &[u8], index: usize) -> Option<u8> {
	if bytes.get(index) != Some(&b'%') {
		return None;
	}
	let high = hex_value(*bytes.get(index + 1)?)?;
	let low = hex_value(*bytes.get(index + 2)?)?;
	Some(high << 4 | low)
}

/// `decodeURI(value)`, or `None` where it throws `URIError` (a malformed
/// escape or an escape sequence that is not UTF-8).
#[must_use]
pub fn js_decode_uri(value: &str) -> Option<String> {
	let bytes = value.as_bytes();
	if !bytes.contains(&b'%') {
		return Some(value.to_owned());
	}
	let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
	let mut index = 0;
	while index < bytes.len() {
		if bytes[index] != b'%' {
			out.push(bytes[index]);
			index += 1;
			continue;
		}
		let first = percent_byte(bytes, index)?;
		if first & 0x80 == 0 {
			if URI_RESERVED_AND_HASH.contains(&first) {
				out.extend_from_slice(&bytes[index..index + 3]);
			} else {
				out.push(first);
			}
			index += 3;
			continue;
		}
		let length = match first.leading_ones() {
			2 => 2,
			3 => 3,
			4 => 4,
			_ => return None,
		};
		let mut sequence = vec![first];
		for continuation in 1..length {
			let byte = percent_byte(bytes, index + continuation * 3)?;
			if byte & 0xC0 != 0x80 {
				return None;
			}
			sequence.push(byte);
		}
		// Rust's UTF-8 validation rejects exactly what the spec's decoding
		// does: overlong forms, surrogates and code points past U+10FFFF.
		std::str::from_utf8(&sequence).ok()?;
		out.extend_from_slice(&sequence);
		index += length * 3;
	}
	String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
	use std::cmp::Ordering;

	use super::{compare_utf16, js_decode_uri, js_split_whitespace, js_trim, json_string};

	#[test]
	fn trims_and_splits_on_unicode_whitespace() {
		assert_eq!(js_trim("\u{3000} a b\u{FEFF}"), "a b");
		assert_eq!(
			js_split_whitespace("a\u{A0}b  c\u{2028}").collect::<Vec<_>>(),
			vec!["a", "b", "c"]
		);
	}

	#[test]
	fn orders_by_utf16_code_units() {
		// U+FF61 sorts after U+1F600 in UTF-8 bytes but before it in UTF-16.
		assert_eq!(compare_utf16("\u{FF61}", "\u{1F600}"), Ordering::Greater);
		assert_eq!(compare_utf16("a", "b"), Ordering::Less);
	}

	#[test]
	fn quotes_like_json_stringify() {
		assert_eq!(json_string("a\"b\\c\n\u{1}"), "\"a\\\"b\\\\c\\n\\u0001\"");
		assert_eq!(json_string("\u{2028}"), "\"\u{2028}\"");
	}

	#[test]
	fn decodes_uri_escapes_but_keeps_reserved_characters_encoded() {
		assert_eq!(js_decode_uri("a%20b%2Fc").as_deref(), Some("a b%2Fc"));
		assert_eq!(js_decode_uri("%E3%81%82").as_deref(), Some("\u{3042}"));
	}

	#[test]
	fn fails_where_decode_uri_throws() {
		assert_eq!(js_decode_uri("%"), None);
		assert_eq!(js_decode_uri("%zz"), None);
		assert_eq!(js_decode_uri("%E3%81"), None);
		assert_eq!(js_decode_uri("%C0%80"), None);
		assert_eq!(js_decode_uri("%80"), None);
	}
}
