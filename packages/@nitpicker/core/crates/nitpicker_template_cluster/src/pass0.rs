//! Pass 0 of the page-template classifier: the corpus-wide, HTML-free
//! blocking that decides which pages are compared with which.
//!
//! The three stages run in a fixed order — first-party stylesheet
//! filtering, blocking-key derivation, orphan reassignment — over only
//! `paths`, `stylesheet_hrefs` and `host`, a few hundred bytes per page.
//! Running them before any page's markup is read lets the per-block
//! clustering hold the HTML of one block at a time, which a 176k-page crawl
//! needs: its markup alone exceeds the memory of a 17 GB machine long before
//! clustering starts.
//!
//! No option is configurable. The stored block keys were produced with the
//! defaults, and every archive keeps the keys it was classified with: a
//! one-segment path section, a stylesheet group of at least two pages, the
//! 0.9 common-href cutoff, first-party filtering and orphan reassignment.

use crate::blocking_reason::BlockingReason;
use crate::filter_first_party_stylesheet_hrefs::filter_first_party_stylesheet_hrefs;
use crate::page_signals::PageSignals;
use crate::reassign_orphan_block_keys::{REASSIGNED_KEY_PREFIX, reassign_orphan_block_keys};
use crate::resolve_blocking_group_keys::{PageBlockingSignals, resolve_blocking_group_keys};

/// The block keys of a corpus and the reason behind each.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockKeys {
	/// One final block key per input page, in input order: `css:<hash>`,
	/// `path:<section>` or `orphan-merge:<section>`. Pages sharing a key
	/// form a block; blocks are ordered by their key's first appearance.
	pub key_of_page: Vec<String>,
	/// The reason of every key, in insertion order: first one per `css:` /
	/// `path:` key the blocking step produced, in order of first appearance
	/// — including keys the orphan merge then renamed away, which no page
	/// carries any more — then one per `orphan-merge:` key, in order of
	/// first appearance among the pages. Every final key has an entry.
	pub reasons: Vec<(String, BlockingReason)>,
}

/// `pages` with each page's stylesheets narrowed to its first-party ones,
/// their hosts kept alongside.
fn keep_first_party(pages: &[PageSignals]) -> Vec<PageSignals> {
	let kept = filter_first_party_stylesheet_hrefs(pages);
	pages
		.iter()
		.zip(kept)
		.map(|(page, stylesheet_hrefs)| {
			// The filter keeps hrefs in order, so each kept href is the next
			// match of its own text.
			let mut hosts = page.stylesheet_hrefs.iter().zip(&page.stylesheet_hosts);
			let stylesheet_hosts = stylesheet_hrefs
				.iter()
				.map(|kept| {
					hosts
						.by_ref()
						.find(|(href, _)| *href == kept)
						.and_then(|(_, host)| host.clone())
				})
				.collect();
			PageSignals {
				paths: page.paths.clone(),
				stylesheet_hrefs,
				stylesheet_hosts,
				host: page.host.clone(),
			}
		})
		.collect()
}

/// Resolves the final block key of every page, and the reason of every
/// distinct key.
///
/// ```text
/// [news/1 {a.css}, news/2 {a.css}, about {}]  (host example.com)
///   -> key_of_page [css:<hash>, css:<hash>, path:about]
/// ```
#[must_use]
pub fn resolve_block_keys(pages: &[PageSignals]) -> BlockKeys {
	// The stored keys were computed with the filter applied twice (once by
	// the driver, once by blocking itself). The second pass recounts the
	// dominant host over what the first kept, which differs from the first
	// whenever pages with a host and pages without one are mixed.
	let once = keep_first_party(pages);
	let first_party_hrefs = filter_first_party_stylesheet_hrefs(&once);
	let blocking_pages: Vec<PageBlockingSignals<'_>> = pages
		.iter()
		.zip(&first_party_hrefs)
		.map(|(page, stylesheet_hrefs)| PageBlockingSignals {
			paths: &page.paths,
			stylesheet_hrefs,
		})
		.collect();

	let raw = resolve_blocking_group_keys(&blocking_pages);
	let final_keys = reassign_orphan_block_keys(&blocking_pages, &raw.keys);

	// Every css:/path: key already has a reason; a key without one is a
	// reassigned key, whose reason is the section it was confined to.
	let mut reasons = raw.reasons;
	for block_key in &final_keys {
		if reasons.contains_key(block_key) {
			continue;
		}
		reasons.insert(
			block_key.clone(),
			BlockingReason::OrphanMerge {
				path_key: block_key
					.get(REASSIGNED_KEY_PREFIX.len()..)
					.unwrap_or_default()
					.to_owned(),
			},
		);
	}

	BlockKeys {
		key_of_page: final_keys,
		reasons: reasons.into_iter().collect(),
	}
}

#[cfg(test)]
mod tests {
	use super::resolve_block_keys;
	use crate::blocking_reason::BlockingReason;
	use crate::page_signals::{PageSignals, test_page};

	fn page(paths: &[&str], hrefs: &[&str]) -> PageSignals {
		test_page(paths, hrefs, None)
	}

	fn page_on(host: &str, paths: &[&str], hrefs: &[&str]) -> PageSignals {
		test_page(paths, hrefs, Some(host))
	}

	#[test]
	fn returns_one_block_key_per_page_in_order() {
		// The third page's different stylesheet keeps a.css below 100%, so it
		// survives as a distinctive css: signal for the first two.
		let keys = resolve_block_keys(&[
			page(&["news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2"], &["https://example.com/a.css"]),
			page(&["about"], &["https://example.com/b.css"]),
		])
		.key_of_page;
		assert_eq!(
			keys,
			vec!["css:ac39f3dbf4cdfdbf", "css:ac39f3dbf4cdfdbf", "path:about"]
		);
	}

	#[test]
	fn an_orphan_joins_the_same_section_css_block() {
		let keys = resolve_block_keys(&[
			page(
				&["news", "1"],
				&[
					"https://example.com/a.css",
					"https://example.com/shared.css",
				],
			),
			page(
				&["news", "2"],
				&[
					"https://example.com/a.css",
					"https://example.com/shared.css",
				],
			),
			page(&["news", "3"], &["https://example.com/shared.css"]),
			page(
				&["about"],
				&[
					"https://example.com/b.css",
					"https://example.com/shared.css",
				],
			),
			page(&["news", "4"], &[]),
		])
		.key_of_page;
		// Every member of the reassigned css: block is renamed, so the whole
		// news section shares one orphan-merge: key rather than a mix.
		assert_eq!(keys[0], "orphan-merge:news");
		assert_eq!(keys[4], "orphan-merge:news");
	}

	#[test]
	fn a_page_host_filters_third_party_fonts_before_blocking() {
		let keys = resolve_block_keys(&[
			page_on(
				"example.com",
				&["a"],
				&[
					"https://example.com/a.css",
					"https://fonts.cdn.example/css?family=x",
				],
			),
			page_on(
				"example.com",
				&["a"],
				&[
					"https://example.com/a.css",
					"https://fonts.cdn.example/css?family=x",
				],
			),
		])
		.key_of_page;
		assert_eq!(keys[0], keys[1]);
	}

	#[test]
	fn filters_twice_so_hostless_pages_follow_the_recounted_dominant_host() {
		// Counted once, cdn.example is on all five pages and dominates, so the
		// pages without a host would keep their cdn stylesheet. Counted again
		// over what the first pass kept (the hosted pages keep only their own
		// a.example sheet), a.example dominates and the hostless pages lose
		// it, falling back to their path section.
		let hosted = |n: &str| {
			page_on(
				"a.example",
				&["news", n],
				&["https://a.example/x.css", "https://cdn.example/font.css"],
			)
		};
		let keys = resolve_block_keys(&[
			hosted("1"),
			hosted("2"),
			hosted("3"),
			page(&["docs", "1"], &["https://cdn.example/y.css"]),
			page(&["docs", "2"], &["https://cdn.example/y.css"]),
		])
		.key_of_page;
		assert_eq!(keys[3], "path:docs");
		assert_eq!(keys[4], "path:docs");
	}

	#[test]
	fn an_empty_corpus_has_no_keys_and_no_reasons() {
		let result = resolve_block_keys(&[]);
		assert!(result.key_of_page.is_empty());
		assert!(result.reasons.is_empty());
	}

	#[test]
	fn css_and_path_reasons_pass_through_when_no_orphan_is_merged() {
		let result = resolve_block_keys(&[
			page(&["news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2"], &["https://example.com/a.css"]),
			page(&["about"], &["https://example.com/b.css"]),
		]);
		assert_eq!(
			result.reasons,
			vec![
				(
					"css:ac39f3dbf4cdfdbf".to_owned(),
					BlockingReason::Css {
						distinctive_stylesheet_hrefs: vec!["https://example.com/a.css".to_owned()],
					}
				),
				(
					"path:about".to_owned(),
					BlockingReason::Path {
						path_key: "about".to_owned()
					}
				),
			]
		);
	}

	#[test]
	fn a_merged_key_gets_an_orphan_merge_reason_with_the_confined_path_key() {
		let result = resolve_block_keys(&[
			page(
				&["news", "1"],
				&[
					"https://example.com/a.css",
					"https://example.com/shared.css",
				],
			),
			page(
				&["news", "2"],
				&[
					"https://example.com/a.css",
					"https://example.com/shared.css",
				],
			),
			page(
				&["about"],
				&[
					"https://example.com/b.css",
					"https://example.com/shared.css",
				],
			),
			page(&["news", "4"], &[]),
		]);
		assert_eq!(result.key_of_page[0], "orphan-merge:news");
		let merged = result
			.reasons
			.iter()
			.find(|(key, _)| key == "orphan-merge:news")
			.map(|(_, reason)| reason);
		assert_eq!(
			merged,
			Some(&BlockingReason::OrphanMerge {
				path_key: "news".to_owned()
			})
		);
	}

	#[test]
	fn reasons_hold_one_entry_per_distinct_key_when_nothing_is_merged() {
		let result = resolve_block_keys(&[
			page(&["news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2"], &["https://example.com/a.css"]),
			page(&["about"], &["https://example.com/b.css"]),
		]);
		assert_eq!(result.key_of_page.len(), 3);
		assert_eq!(result.reasons.len(), 2);
	}

	#[test]
	fn reasons_keep_the_renamed_away_keys_then_add_orphan_merge_keys_in_first_seen_order() {
		// The raw css: and path: keys of both sections are renamed by the
		// merge, yet their reasons stay in first-appearance order; the
		// orphan-merge: reasons follow, in the order those keys first
		// appear among the pages (docs before news).
		let result = resolve_block_keys(&[
			page(&["docs", "1"], &["https://example.com/b.css"]),
			page(&["news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2"], &["https://example.com/a.css"]),
			page(&["news", "3"], &[]),
			page(&["docs", "2"], &["https://example.com/b.css"]),
			page(&["docs", "3"], &[]),
		]);
		let keys: Vec<&str> = result.reasons.iter().map(|(key, _)| key.as_str()).collect();
		assert_eq!(
			keys,
			vec![
				"css:edc3241292b613b0",
				"css:ac39f3dbf4cdfdbf",
				"path:news",
				"path:docs",
				"orphan-merge:docs",
				"orphan-merge:news",
			]
		);
	}
}
