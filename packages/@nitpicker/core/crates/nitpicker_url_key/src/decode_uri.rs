/// Characters `decodeURI` leaves escaped: the URI reserved set plus `#`.
const RESERVED: &[u8] = b";/?:@&=+$,#";

/// Decodes `%XX` escapes the way JavaScript's `decodeURI` does.
///
/// An escape that forms valid UTF-8 becomes the character, except that a
/// single-byte escape of a reserved character (`%2F`, `%3F`, ...) stays as
/// written, so decoding never changes where a URL's parts split. Returns
/// `None` where `decodeURI` throws (a `%` without two hex digits, a lead
/// byte without its continuation escapes, overlong or surrogate or
/// out-of-range UTF-8); the caller then keeps the text as written.
pub(crate) fn decode_uri(text: &str) -> Option<String> {
	if !text.contains('%') {
		return Some(text.to_owned());
	}
	let bytes = text.as_bytes();
	let mut out = String::with_capacity(text.len());
	let mut i = 0;
	while i < bytes.len() {
		if bytes[i] != b'%' {
			// Copy up to the next `%` whole: `%` is ASCII, so the slice ends on
			// a character boundary.
			let end = text[i..].find('%').map_or(bytes.len(), |offset| i + offset);
			out.push_str(&text[i..end]);
			i = end;
			continue;
		}
		let first = hex_byte(bytes, i)?;
		if first < 0x80 {
			if RESERVED.contains(&first) {
				out.push_str(&text[i..i + 3]);
			} else {
				out.push(char::from(first));
			}
			i += 3;
			continue;
		}
		let length = match first {
			0xC0..=0xDF => 2,
			0xE0..=0xEF => 3,
			0xF0..=0xF7 => 4,
			_ => return None,
		};
		let mut sequence = vec![first];
		for step in 1..length {
			sequence.push(hex_byte(bytes, i + step * 3)?);
		}
		out.push_str(std::str::from_utf8(&sequence).ok()?);
		i += length * 3;
	}
	Some(out)
}

/// Reads the `%XX` escape at `at`; `None` when it is not one.
fn hex_byte(bytes: &[u8], at: usize) -> Option<u8> {
	if bytes.get(at) != Some(&b'%') {
		return None;
	}
	let high = hex_digit(*bytes.get(at + 1)?)?;
	let low = hex_digit(*bytes.get(at + 2)?)?;
	Some((high << 4) | low)
}

/// The value of one hex digit, in either case.
fn hex_digit(byte: u8) -> Option<u8> {
	match byte {
		b'0'..=b'9' => Some(byte - b'0'),
		b'a'..=b'f' => Some(byte - b'a' + 10),
		b'A'..=b'F' => Some(byte - b'A' + 10),
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::decode_uri;

	#[test]
	fn leaves_text_without_escapes_alone() {
		assert_eq!(decode_uri("plain/text").as_deref(), Some("plain/text"));
	}

	#[test]
	fn decodes_multibyte_utf8() {
		assert_eq!(decode_uri("%e3%81%82").as_deref(), Some("あ"));
		assert_eq!(decode_uri("%F0%9F%98%80").as_deref(), Some("😀"));
	}

	#[test]
	fn decodes_ascii_escapes_except_reserved_ones() {
		assert_eq!(decode_uri("a%20b%41").as_deref(), Some("a bA"));
		assert_eq!(
			decode_uri("a%2fb%3Fc%23d").as_deref(),
			Some("a%2fb%3Fc%23d")
		);
	}

	#[test]
	fn fails_where_decode_uri_throws() {
		assert_eq!(decode_uri("100%"), None);
		assert_eq!(decode_uri("%zz"), None);
		assert_eq!(decode_uri("%e3%81"), None);
		assert_eq!(decode_uri("%e3x"), None);
		assert_eq!(decode_uri("%80"), None);
		assert_eq!(decode_uri("%c0%af"), None);
		assert_eq!(decode_uri("%ed%a0%80"), None);
		assert_eq!(decode_uri("%f8%88%80%80%80"), None);
	}
}
