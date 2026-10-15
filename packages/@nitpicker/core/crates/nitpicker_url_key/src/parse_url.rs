use url::Url;

/// The parts of a URL the sort key reads.
///
/// Mirrors the fields of `@d-zero/shared`'s `parseUrl` that matter for
/// ordering, so the key sees the URL as the rest of Nitpicker does. The port
/// and credentials are left out on purpose: they only distinguish otherwise
/// equal URLs, which the raw string at the end of the key orders.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ParsedUrl {
	/// Scheme with its colon (`https:`); empty when the URL did not parse.
	pub protocol: String,
	/// Host without port; empty for a URL that is not HTTP(S).
	pub hostname: String,
	/// Path split on `/` after runs of `/` collapse; a trailing slash leaves
	/// a last empty segment. Empty for a URL that is not HTTP(S).
	pub segments: Vec<String>,
	/// Query without `?`, with `PHPSESSID` removed and the pairs sorted by name.
	pub search: String,
	/// Fragment with its `#`.
	pub hash: String,
}

/// Parses `raw` like `@d-zero/shared`'s `parseUrl`.
///
/// A string `new URL` rejects comes back empty; a URL that parses but is not
/// HTTP(S) (`mailto:`, `tel:`) keeps only its protocol. Both then order by
/// the raw string.
pub(crate) fn parse_url(raw: &str) -> ParsedUrl {
	let Ok(url) = Url::parse(raw) else {
		return ParsedUrl::default();
	};
	let protocol = format!("{}:", url.scheme());
	if !matches!(url.scheme(), "http" | "https") {
		return ParsedUrl {
			protocol,
			..ParsedUrl::default()
		};
	}

	let path = collapse_slashes(url.path());
	let segments = path
		.strip_prefix('/')
		.unwrap_or(&path)
		.split('/')
		.map(str::to_owned)
		.collect();
	let search = url.query().map(normalize_query).unwrap_or_default();
	let hash = url
		.fragment()
		.filter(|fragment| !fragment.is_empty())
		.map(|fragment| format!("#{fragment}"))
		.unwrap_or_default();
	let hostname = url.host_str().unwrap_or_default().to_owned();

	ParsedUrl {
		protocol,
		hostname,
		segments,
		search,
		hash,
	}
}

/// Collapses each run of `/` into one.
fn collapse_slashes(path: &str) -> String {
	let mut out = String::with_capacity(path.len());
	for c in path.chars() {
		if c != '/' || !out.ends_with('/') {
			out.push(c);
		}
	}
	out
}

/// `new URLSearchParams(query)` with `PHPSESSID` deleted, sorted and
/// serialized back (`URLSearchParams.prototype.sort` is stable and orders by
/// name in UTF-16 code units).
fn normalize_query(query: &str) -> String {
	let mut pairs: Vec<(String, String)> = form_urlencoded::parse(query.as_bytes())
		.filter(|(name, _)| name != "PHPSESSID")
		.map(|(name, value)| (name.into_owned(), value.into_owned()))
		.collect();
	pairs.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
	form_urlencoded::Serializer::new(String::new())
		.extend_pairs(pairs)
		.finish()
}

#[cfg(test)]
mod tests {
	use super::parse_url;

	#[test]
	fn splits_an_http_url() {
		let parsed = parse_url("https://Example.com:8080/a//b/c.html?z=1&a=2#frag");
		assert_eq!(parsed.protocol, "https:");
		assert_eq!(parsed.hostname, "example.com");
		assert_eq!(parsed.segments, ["a", "b", "c.html"]);
		assert_eq!(parsed.search, "a=2&z=1");
		assert_eq!(parsed.hash, "#frag");
	}

	#[test]
	fn marks_a_trailing_slash_with_an_empty_last_segment() {
		assert_eq!(parse_url("https://example.com/a/").segments, ["a", ""]);
		assert_eq!(parse_url("https://example.com/").segments, [""]);
	}

	#[test]
	fn drops_the_session_id_and_orders_the_pairs() {
		assert_eq!(
			parse_url("http://example.com/p?PHPSESSID=x&b=1&a=2").search,
			"a=2&b=1"
		);
		assert_eq!(parse_url("http://example.com/p?PHPSESSID=x").search, "");
	}

	#[test]
	fn reads_an_empty_fragment_as_none() {
		assert_eq!(parse_url("https://example.com/p#").hash, "");
	}

	#[test]
	fn keeps_only_the_protocol_of_a_non_http_url() {
		let parsed = parse_url("mailto:someone@example.com");
		assert_eq!(parsed.protocol, "mailto:");
		assert!(parsed.hostname.is_empty());
		assert!(parsed.segments.is_empty());
	}

	#[test]
	fn returns_nothing_for_a_string_that_does_not_parse() {
		let parsed = parse_url("not a url");
		assert!(parsed.protocol.is_empty());
		assert!(parsed.hostname.is_empty());
		assert!(parsed.segments.is_empty());
	}
}
