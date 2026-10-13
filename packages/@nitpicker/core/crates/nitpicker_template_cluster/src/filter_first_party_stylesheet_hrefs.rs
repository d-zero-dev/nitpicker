//! Narrowing every page's stylesheet hrefs to the first-party ones, so a
//! page's incidental third-party embeds do not contaminate the blocking
//! signal.
//!
//! A video player's own stylesheet, a per-embed tracking URL that resembles
//! one, a widget's extra webfont: all are incidental to whatever third-party
//! content a page happens to embed, not evidence of its template. The
//! document-frequency filtering that follows cannot tell "rare because the
//! template is distinctive" from "rare because few pages embed this third
//! party", so such hrefs would split otherwise identical pages away from
//! their section. Dropping them at the source is simpler than recognizing
//! their effects later.
//!
//! A page that supplies its `host` is judged against it alone. That path
//! cannot mistake a third party for the first party however many pages
//! embed it; the fallback can: when every page loads both its own stylesheet
//! and the same sitewide third-party font, both hosts tie at "referenced by
//! 100% of pages" and the first one counted wins, silently the wrong one on
//! a real crawl.
//!
//! The fallback, used per page for pages without a `host`, takes the host
//! referenced by the most *pages* (not `<link>` tags: a page with one
//! first-party stylesheet and two third-party font requests must not let the
//! font host outvote the site), compared by `host` (hostname plus port) and
//! not origin, so one site served over both `http:` and `https:` is one
//! host. It assumes a roughly homogeneous batch, drops a second first-party
//! host (a CDN subdomain) like any third party, and keeps the first-counted
//! host on a tie. A page with neither a `host` nor any dominant host (no
//! page has a parseable stylesheet href) keeps its hrefs unchanged: this
//! narrows signal, it does not fabricate it.

use indexmap::{IndexMap, IndexSet};

use crate::page_signals::PageSignals;

/// Each page's stylesheet hrefs kept to its first-party host, in the pages'
/// order and each page's own href order. Unparseable hrefs (no host) never
/// match a host and are dropped, except on a page left unchanged (see the
/// module docs).
///
/// ```text
/// [{hrefs: [https://example.com/a.css, https://fonts.cdn.example/css]}]
///     -> [[https://example.com/a.css]]   (the dominant host is example.com)
/// ```
#[must_use]
pub fn filter_first_party_stylesheet_hrefs(pages: &[PageSignals]) -> Vec<Vec<String>> {
	// First-seen order is the tie-break, so the counts live in an insertion-
	// ordered map.
	let mut host_page_counts: IndexMap<&str, usize> = IndexMap::new();
	for page in pages {
		let distinct_hosts: IndexSet<&str> = page
			.stylesheet_hosts
			.iter()
			.flatten()
			.map(String::as_str)
			.collect();
		for host in distinct_hosts {
			*host_page_counts.entry(host).or_insert(0) += 1;
		}
	}

	let mut dominant_host: Option<&str> = None;
	let mut dominant_count = 0;
	for (host, count) in &host_page_counts {
		if *count > dominant_count {
			dominant_host = Some(host);
			dominant_count = *count;
		}
	}

	pages
		.iter()
		.map(|page| {
			let Some(expected_host) = page.host.as_deref().or(dominant_host) else {
				return page.stylesheet_hrefs.clone();
			};
			page.stylesheet_hrefs
				.iter()
				.zip(&page.stylesheet_hosts)
				.filter(|(_, host)| host.as_deref() == Some(expected_host))
				.map(|(href, _)| href.clone())
				.collect()
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::filter_first_party_stylesheet_hrefs;
	use crate::page_signals::{PageSignals, test_page};

	fn page(host: Option<&str>, hrefs: &[&str]) -> PageSignals {
		test_page(&[], hrefs, host)
	}

	fn hrefs(values: &[&str]) -> Vec<String> {
		values.iter().map(|value| (*value).to_owned()).collect()
	}

	#[test]
	fn drops_a_third_party_href_by_the_dominant_host() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(
				None,
				&["https://example.com/a.css", "https://example.com/b.css"],
			),
			page(
				None,
				&[
					"https://example.com/a.css",
					"https://fonts.cdn.example/css?family=x",
				],
			),
		]);
		assert_eq!(
			result,
			vec![
				hrefs(&["https://example.com/a.css", "https://example.com/b.css"]),
				hrefs(&["https://example.com/a.css"]),
			]
		);
	}

	#[test]
	fn an_empty_page_list_gives_an_empty_result() {
		assert_eq!(
			filter_first_party_stylesheet_hrefs(&[]),
			Vec::<Vec<String>>::new()
		);
	}

	#[test]
	fn a_batch_loading_no_stylesheets_is_unchanged() {
		assert_eq!(
			filter_first_party_stylesheet_hrefs(&[page(None, &[]), page(None, &[])]),
			vec![Vec::<String>::new(), Vec::new()]
		);
	}

	#[test]
	fn a_distinctive_third_party_href_on_a_first_party_page_is_dropped() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(None, &["https://example.com/a.css"]),
			page(
				None,
				&[
					"https://example.com/a.css",
					"https://www.video.example/s/player.css",
				],
			),
		]);
		assert_eq!(result[1], hrefs(&["https://example.com/a.css"]));
	}

	#[test]
	fn a_tie_keeps_the_host_counted_first_and_drops_the_other() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(None, &["https://a.example.com/x.css"]),
			page(None, &["https://b.example.com/y.css"]),
		]);
		assert_eq!(result[0], hrefs(&["https://a.example.com/x.css"]));
		assert_eq!(result[1], Vec::<String>::new());
	}

	#[test]
	fn a_tie_is_broken_by_first_seen_order_across_pages_not_by_name() {
		// b.example.com is counted first (page 0), a.example.com second.
		let result = filter_first_party_stylesheet_hrefs(&[
			page(None, &["https://b.example.com/y.css"]),
			page(None, &["https://a.example.com/x.css"]),
		]);
		assert_eq!(result[0], hrefs(&["https://b.example.com/y.css"]));
		assert_eq!(result[1], Vec::<String>::new());
	}

	#[test]
	fn a_tie_within_one_page_is_broken_by_href_order() {
		let result = filter_first_party_stylesheet_hrefs(&[page(
			None,
			&["https://z.example/x.css", "https://a.example/y.css"],
		)]);
		assert_eq!(result[0], hrefs(&["https://z.example/x.css"]));
	}

	#[test]
	fn a_page_host_resolves_a_tie_the_fallback_would_get_wrong() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(
				Some("example.com"),
				&[
					"https://fonts.cdn.example/css?family=x",
					"https://example.com/a.css",
				],
			),
			page(
				Some("example.com"),
				&[
					"https://fonts.cdn.example/css?family=x",
					"https://example.com/b.css",
				],
			),
		]);
		assert_eq!(result[0], hrefs(&["https://example.com/a.css"]));
		assert_eq!(result[1], hrefs(&["https://example.com/b.css"]));
	}

	#[test]
	fn a_page_without_a_host_still_uses_the_dominant_host() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(Some("example.com"), &["https://example.com/a.css"]),
			page(
				None,
				&["https://example.com/a.css", "https://fonts.cdn.example/css"],
			),
		]);
		assert_eq!(result[0], hrefs(&["https://example.com/a.css"]));
		assert_eq!(result[1], hrefs(&["https://example.com/a.css"]));
	}

	#[test]
	fn unparsable_hrefs_are_dropped_and_never_an_origin() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(None, &["https://example.com/a.css", "not a url"]),
			page(None, &["https://example.com/a.css"]),
		]);
		assert_eq!(result[0], hrefs(&["https://example.com/a.css"]));
	}

	#[test]
	fn dominance_counts_pages_not_link_tags() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(
				None,
				&[
					"https://example.com/site.css",
					"https://fonts.cdn.example/css?family=a",
					"https://fonts.cdn.example/css?family=b",
				],
			),
			page(None, &["https://example.com/site.css"]),
		]);
		assert_eq!(result[0], hrefs(&["https://example.com/site.css"]));
		assert_eq!(result[1], hrefs(&["https://example.com/site.css"]));
	}

	#[test]
	fn one_host_over_http_and_https_is_a_single_host() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(None, &["http://example.com/a.css"]),
			page(None, &["https://example.com/a.css"]),
			page(
				None,
				&[
					"https://cdn-evil.example/x.css",
					"https://cdn-evil.example/y.css",
				],
			),
		]);
		assert_eq!(result[0], hrefs(&["http://example.com/a.css"]));
		assert_eq!(result[1], hrefs(&["https://example.com/a.css"]));
		assert_eq!(result[2], Vec::<String>::new());
	}

	#[test]
	fn a_batch_with_only_unparsable_hrefs_keeps_them_unchanged() {
		let result = filter_first_party_stylesheet_hrefs(&[
			page(None, &["not a url", "/a.css"]),
			page(None, &[]),
		]);
		assert_eq!(result[0], hrefs(&["not a url", "/a.css"]));
		assert_eq!(result[1], Vec::<String>::new());
	}

	#[test]
	fn hrefs_are_judged_by_the_hosts_the_caller_supplies() {
		// `new URL` lowercases the host and drops a default port; the filter
		// compares what it was given, not the href text.
		let result = filter_first_party_stylesheet_hrefs(&[PageSignals {
			paths: Vec::new(),
			stylesheet_hrefs: hrefs(&[
				"http://EXAMPLE.com:8080/a.css",
				"http://example.com/b.css",
				"https://example.com:443/c.css",
			]),
			stylesheet_hosts: vec![
				Some("example.com:8080".to_owned()),
				Some("example.com".to_owned()),
				Some("example.com".to_owned()),
			],
			host: Some("example.com:8080".to_owned()),
		}]);
		assert_eq!(result[0], hrefs(&["http://EXAMPLE.com:8080/a.css"]));
	}

	#[test]
	fn an_empty_page_host_matches_only_hosts_that_parse_to_empty() {
		let result = filter_first_party_stylesheet_hrefs(&[page(
			Some(""),
			&["data:text/css,a", "https://example.com/a.css"],
		)]);
		assert_eq!(result[0], hrefs(&["data:text/css,a"]));
	}
}
