use std::borrow::Cow;

/// The five entities the serializer writes, with the bytes they stand for.
const ENTITIES: [(&[u8], &[u8]); 5] = [
	(b"&amp;", b"&"),
	(b"&lt;", b"<"),
	(b"&gt;", b">"),
	(b"&quot;", b"\""),
	(b"&nbsp;", "\u{a0}".as_bytes()),
];

/// Decodes an attribute value as the serializer wrote it: `&amp;`, `&lt;`,
/// `&gt;`, `&quot;` and `&nbsp;` (lower case, with the semicolon) and nothing
/// else. Any other `&` stays as it is, so `&AMP;` and `&#38;` are not
/// decoded. A value without `&` is returned as it is, without copying.
///
/// # Examples
///
/// ```
/// use nitpicker_html_scan::decode_serialized_attribute_value;
///
/// assert_eq!(decode_serialized_attribute_value(b"a&amp;b").as_ref(), b"a&b");
/// assert_eq!(decode_serialized_attribute_value(b"&amp;amp;").as_ref(), b"&amp;");
/// ```
#[must_use]
pub fn decode_serialized_attribute_value(value: &[u8]) -> Cow<'_, [u8]> {
	if !value.contains(&b'&') {
		return Cow::Borrowed(value);
	}
	let mut decoded = Vec::with_capacity(value.len());
	let mut index = 0;
	while index < value.len() {
		let rest = &value[index..];
		if rest[0] == b'&'
			&& let Some((entity, replacement)) =
				ENTITIES.iter().find(|(entity, _)| rest.starts_with(entity))
		{
			decoded.extend_from_slice(replacement);
			index += entity.len();
		} else {
			decoded.push(rest[0]);
			index += 1;
		}
	}
	Cow::Owned(decoded)
}

#[cfg(test)]
mod tests {
	use super::decode_serialized_attribute_value;

	fn decode(value: &str) -> String {
		String::from_utf8(decode_serialized_attribute_value(value.as_bytes()).into_owned()).unwrap()
	}

	#[test]
	fn decodes_the_five_entities() {
		assert_eq!(decode("&amp;&lt;&gt;&quot;&nbsp;"), "&<>\"\u{a0}");
	}

	#[test]
	fn decodes_in_one_pass() {
		assert_eq!(decode("&amp;lt;"), "&lt;");
		assert_eq!(decode("&amp;amp;"), "&amp;");
	}

	#[test]
	fn leaves_every_other_ampersand() {
		assert_eq!(
			decode("&AMP; &#38; &amp &copy; a&b&"),
			"&AMP; &#38; &amp &copy; a&b&"
		);
	}

	#[test]
	fn borrows_a_value_without_an_ampersand() {
		let value = b"plain";
		assert!(matches!(
			decode_serialized_attribute_value(value),
			std::borrow::Cow::Borrowed(_)
		));
	}
}
