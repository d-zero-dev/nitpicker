use url::Url;

/// The two keys under which pages are grouped as the same page under
/// another URL.
///
/// Both are built from the host, the port, the path and the query of an
/// `http` or `https` URL, written `host[:port]path[?query]`:
///
/// - **Tier A** folds what is safe to treat as one resource from the URL
///   alone: the scheme (`http` and `https` give the same key, since a default
///   port is left out), the case of the host, and a trailing `/index.{ext}`
///   (`/about/index.html` becomes `/about/`).
/// - **Tier B** is Tier A with one trailing `/` of the path dropped (the path
///   `/` stays): a weaker signal, since a server may serve different pages at
///   `/foo` and `/foo/`, so a caller confirms it by comparing the content.
///
/// The fragment is never part of a key. An empty query (`/p?`) is no query.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct AliasKeys {
	/// The Tier A key.
	pub tier_a: String,
	/// The Tier B key.
	pub tier_b: String,
}

/// Computes both alias keys of `url`, parsing it once.
///
/// Returns `None` for a string that does not parse, and for a URL that is not
/// `http` or `https`: such a URL is left out of alias grouping altogether.
///
/// # Examples
///
/// ```
/// let keys = nitpicker_url_key::alias_keys("http://Example.com/about/index.html").unwrap();
/// assert_eq!(keys.tier_a, "example.com/about/");
/// assert_eq!(keys.tier_b, "example.com/about");
/// assert!(nitpicker_url_key::alias_keys("mailto:a@example.com").is_none());
/// ```
#[must_use]
pub fn alias_keys(url: &str) -> Option<AliasKeys> {
	let parsed = Url::parse(url).ok()?;
	if !matches!(parsed.scheme(), "http" | "https") {
		return None;
	}
	let host = parsed.host_str().unwrap_or_default();
	let path = fold_index_page(parsed.path());
	let query = parsed.query().filter(|query| !query.is_empty());

	let key = |path: &str| {
		let mut key = String::with_capacity(host.len() + path.len() + 8);
		key.push_str(host);
		if let Some(port) = parsed.port() {
			key.push(':');
			key.push_str(&port.to_string());
		}
		key.push_str(path);
		if let Some(query) = query {
			key.push('?');
			key.push_str(query);
		}
		key
	};

	// The bare root path `/` keeps its slash.
	let without_trailing_slash = if path.len() > 1 {
		path.strip_suffix('/').unwrap_or(&path)
	} else {
		&path
	};
	Some(AliasKeys {
		tier_a: key(&path),
		tier_b: key(without_trailing_slash),
	})
}

/// Replaces a trailing `/index.{ext}` (`ext` being one or more of
/// `[A-Za-z0-9_]`, `index` in any letter case) by `/`.
fn fold_index_page(path: &str) -> String {
	let Some(slash) = path.rfind('/') else {
		return path.to_owned();
	};
	let (directory, last) = path.split_at(slash + 1);
	let is_index_page = last
		.get(..6)
		.is_some_and(|head| head.eq_ignore_ascii_case("index."))
		&& last.len() > 6
		&& last[6..]
			.bytes()
			.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
	if is_index_page {
		directory.to_owned()
	} else {
		path.to_owned()
	}
}

#[cfg(test)]
mod tests {
	use super::alias_keys;

	fn keys(url: &str) -> (String, String) {
		let keys = alias_keys(url).expect("a parseable http(s) URL");
		(keys.tier_a, keys.tier_b)
	}

	#[test]
	fn folds_the_scheme_the_host_case_and_the_index_page() {
		assert_eq!(
			keys("http://Example.com/about/index.html").0,
			"example.com/about/"
		);
		assert_eq!(keys("https://example.com/about/").0, "example.com/about/");
	}

	#[test]
	fn drops_one_trailing_slash_for_tier_b() {
		assert_eq!(keys("https://example.com/foo/").1, "example.com/foo");
		assert_eq!(keys("https://example.com/foo").1, "example.com/foo");
		assert_eq!(keys("https://example.com/foo//").1, "example.com/foo/");
	}

	#[test]
	fn keeps_the_root_slash_for_tier_b() {
		assert_eq!(keys("https://example.com/").1, "example.com/");
		assert_eq!(keys("https://example.com").1, "example.com/");
	}

	#[test]
	fn keeps_a_non_default_port_and_drops_a_default_one() {
		assert_eq!(keys("https://example.com:8443/a").0, "example.com:8443/a");
		assert_eq!(keys("https://example.com:443/a").0, "example.com/a");
		assert_eq!(keys("http://example.com:443/a").0, "example.com:443/a");
	}

	#[test]
	fn keeps_the_query_and_never_the_fragment() {
		assert_eq!(
			keys("https://example.com/a?x=1&y=2#top").0,
			"example.com/a?x=1&y=2"
		);
		assert_eq!(keys("https://example.com/a?#top").0, "example.com/a");
		assert_eq!(keys("https://example.com/a#top").0, "example.com/a");
	}

	#[test]
	fn folds_the_index_page_only_as_the_last_segment() {
		assert_eq!(keys("https://example.com/index.php").0, "example.com/");
		assert_eq!(keys("https://example.com/INDEX.HTM").0, "example.com/");
		assert_eq!(keys("https://example.com/index/a").0, "example.com/index/a");
		assert_eq!(
			keys("https://example.com/index.html/a").0,
			"example.com/index.html/a"
		);
		assert_eq!(keys("https://example.com/index.").0, "example.com/index.");
		assert_eq!(
			keys("https://example.com/index.tar.gz").0,
			"example.com/index.tar.gz"
		);
		assert_eq!(
			keys("https://example.com/index2.html").0,
			"example.com/index2.html"
		);
	}

	#[test]
	fn folds_the_index_page_before_tier_b_drops_the_slash() {
		assert_eq!(keys("https://example.com/a/index.html").1, "example.com/a");
	}

	#[test]
	fn writes_an_ipv6_host_in_brackets_and_an_idn_host_in_punycode() {
		assert_eq!(keys("http://[::1]:3000/a").0, "[::1]:3000/a");
		assert_eq!(
			keys("https://日本語.example/a").0,
			"xn--wgv71a119e.example/a"
		);
	}

	#[test]
	fn leaves_out_what_is_not_an_http_url() {
		assert!(alias_keys("mailto:a@example.com").is_none());
		assert!(alias_keys("ftp://example.com/a").is_none());
		assert!(alias_keys("not a url").is_none());
		assert!(alias_keys("").is_none());
	}
}
