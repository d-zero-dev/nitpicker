//! The HTML-free inputs of Pass 0.

/// What Pass 0 reads of one page: the blocking signals plus the page's own
/// URL host. HTML is deliberately absent — blocking runs over the whole
/// corpus before any page's markup is held, so only these few hundred bytes
/// per page are needed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PageSignals {
	/// The page URL's path segments (`ExURL.paths`); a directory-style URL
	/// ends in an empty segment.
	pub paths: Vec<String>,
	/// Absolute hrefs of the page's stylesheets, in document order.
	pub stylesheet_hrefs: Vec<String>,
	/// `new URL(href).host` of each of `stylesheet_hrefs`, `None` where it
	/// throws. The caller computes it: the URL standard's host parsing
	/// (IDNA, IPv4/IPv6 forms, default ports) is the JS platform's own, so
	/// it is taken from there rather than reimplemented.
	pub stylesheet_hosts: Vec<Option<String>>,
	/// The page URL's `host` (hostname plus a non-default port), when known.
	/// A page without one is judged against the batch's dominant stylesheet
	/// host instead.
	pub host: Option<String>,
}

/// The host of the plain `scheme://host[:port]/…` URLs tests use, `""` for
/// `data:` and `None` otherwise — a stand-in for `new URL(href).host` that
/// only has to agree with it on those inputs.
#[cfg(test)]
pub fn test_host(href: &str) -> Option<String> {
	if href.starts_with("data:") {
		return Some(String::new());
	}
	let (_, rest) = href.split_once("://")?;
	let authority = rest.split(['/', '?', '#']).next()?;
	(!authority.is_empty()).then(|| authority.to_owned())
}

/// [`PageSignals`] for tests, the hosts derived by [`test_host`].
#[cfg(test)]
pub fn test_page(paths: &[&str], hrefs: &[&str], host: Option<&str>) -> PageSignals {
	PageSignals {
		paths: paths.iter().map(|value| (*value).to_owned()).collect(),
		stylesheet_hrefs: hrefs.iter().map(|value| (*value).to_owned()).collect(),
		stylesheet_hosts: hrefs.iter().map(|href| test_host(href)).collect(),
		host: host.map(str::to_owned),
	}
}
