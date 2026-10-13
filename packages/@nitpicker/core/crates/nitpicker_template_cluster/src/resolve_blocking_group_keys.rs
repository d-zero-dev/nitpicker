//! Choosing, per page, which blocking signal becomes its block key.
//!
//! Entity-resolution blocking combines independent predicates with OR to
//! generate candidate pairs for a later classifier. Here each page is
//! committed to exactly one key instead: Stage A refines inside a key's pool
//! but cannot pull in a page this routed elsewhere, so the choice is
//! effectively final. A true OR-merge is not done because a union of
//! equivalence relations can only coarsen a partition, whereas the point of
//! preferring the stylesheet signal is that it *splits* pages a path-only
//! grouping would lump together (a page under an otherwise uniform URL
//! section that loads a different stylesheet set). So: try the strong
//! signal, fall back to the weak one.
//!
//! Before the stylesheet sets are compared, hrefs that recur across most
//! stylesheet-bearing pages (a shared reset or font) are stripped by
//! document frequency; otherwise two unrelated sections loading only that
//! one stylesheet would pass for one template family. The key then carries
//! no information, which raising the minimum group size cannot fix. A page
//! whose set is empty, or empties out, falls back to the path key: loading
//! no distinctive stylesheet is an absence of evidence and must never be a
//! matching signal itself. The frequency is taken over stylesheet-bearing
//! pages only; stylesheet-less pages in the denominator would dilute every
//! ratio and let a site-wide stylesheet read as distinctive.
//!
//! The batch is assumed roughly homogeneous (see
//! `compute_document_frequency`); splitting a heterogeneous crawl first is
//! the caller's job.

use indexmap::{IndexMap, IndexSet};
use rustc_hash::FxHashMap;

use crate::blocking_reason::BlockingReason;
use crate::compute_document_frequency::compute_document_frequency;
use crate::derive_path_group_key::derive_path_group_key;
use crate::derive_stylesheet_group_key::derive_stylesheet_group_key;
use crate::js_string::compare_utf16;
use crate::split_tokens_by_frequency::{
	DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD, split_tokens_by_frequency,
};

/// A stylesheet-derived key is trusted only when this many pages share it.
/// At least 2: a page always shares its key with itself, so 1 would accept
/// every stylesheet-bearing page and make the check a no-op. A structural
/// floor (below 2 no pair of pages exists), not a statistically derived
/// confidence.
const MIN_CSS_GROUP_SIZE: usize = 2;

/// The two blocking signals of one page.
#[derive(Debug, Clone, Copy)]
pub struct PageBlockingSignals<'a> {
	/// The page URL's path segments.
	pub paths: &'a [String],
	/// The page's stylesheet hrefs (already narrowed to first party).
	pub stylesheet_hrefs: &'a [String],
}

/// One block key per page, and the reason behind each distinct key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockingGroupKeys {
	/// `css:<hash>` or `path:<section>`, per page in input order.
	pub keys: Vec<String>,
	/// One reason per distinct key, in the order the keys first appear.
	pub reasons: IndexMap<String, BlockingReason>,
}

/// Resolves every page's blocking key: its distinctive stylesheet set when
/// at least `MIN_CSS_GROUP_SIZE` pages share it, else its path section.
///
/// ```text
/// [dept-a/news/1 {a.css, common.css}, dept-a/news/2 {a.css, common.css},
///  dept-b/about {common.css}, dept-c/contact {common.css}]
///   -> [css:ac39f3dbf4cdfdbf, css:ac39f3dbf4cdfdbf, path:dept-b, path:dept-c]
/// ```
#[must_use]
pub fn resolve_blocking_group_keys(pages: &[PageBlockingSignals<'_>]) -> BlockingGroupKeys {
	let href_sets: Vec<IndexSet<&str>> = pages
		.iter()
		.map(|page| page.stylesheet_hrefs.iter().map(String::as_str).collect())
		.collect();
	let corpus_frequency = compute_document_frequency(
		href_sets
			.iter()
			.filter(|href_set| !href_set.is_empty())
			.map(|href_set| href_set.iter().copied()),
	);

	let distinctive_hrefs: Vec<Vec<&str>> = href_sets
		.iter()
		.map(|href_set| {
			split_tokens_by_frequency(
				href_set.iter().copied(),
				&corpus_frequency,
				DEFAULT_TEMPLATE_FREQUENCY_THRESHOLD,
			)
			.content_tokens
		})
		.collect();

	let css_keys: Vec<Option<String>> = distinctive_hrefs
		.iter()
		.map(|hrefs| (!hrefs.is_empty()).then(|| derive_stylesheet_group_key(hrefs)))
		.collect();

	let mut css_key_counts: FxHashMap<&str, usize> = FxHashMap::default();
	for css_key in css_keys.iter().flatten() {
		*css_key_counts.entry(css_key.as_str()).or_insert(0) += 1;
	}

	let mut reasons: IndexMap<String, BlockingReason> = IndexMap::new();
	let mut keys = Vec::with_capacity(pages.len());
	for (index, page) in pages.iter().enumerate() {
		if let Some(css_key) = &css_keys[index]
			&& css_key_counts.get(css_key.as_str()).copied().unwrap_or(0) >= MIN_CSS_GROUP_SIZE
		{
			let key = format!("css:{css_key}");
			if !reasons.contains_key(&key) {
				let mut sorted = distinctive_hrefs[index].clone();
				sorted.sort_by(|a, b| compare_utf16(a, b));
				reasons.insert(
					key.clone(),
					BlockingReason::Css {
						distinctive_stylesheet_hrefs: sorted
							.into_iter()
							.map(str::to_owned)
							.collect(),
					},
				);
			}
			keys.push(key);
			continue;
		}
		let path_key = derive_path_group_key(page.paths);
		let key = format!("path:{path_key}");
		if !reasons.contains_key(&key) {
			reasons.insert(key.clone(), BlockingReason::Path { path_key });
		}
		keys.push(key);
	}

	BlockingGroupKeys { keys, reasons }
}

#[cfg(test)]
mod tests {
	use super::{PageBlockingSignals, resolve_blocking_group_keys};
	use crate::blocking_reason::BlockingReason;

	/// Owns what `PageBlockingSignals` borrows.
	struct Page {
		paths: Vec<String>,
		hrefs: Vec<String>,
	}

	fn page(paths: &[&str], hrefs: &[&str]) -> Page {
		Page {
			paths: paths.iter().map(|value| (*value).to_owned()).collect(),
			hrefs: hrefs.iter().map(|value| (*value).to_owned()).collect(),
		}
	}

	fn keys(pages: &[Page]) -> Vec<String> {
		resolve(pages).keys
	}

	fn resolve(pages: &[Page]) -> super::BlockingGroupKeys {
		let signals: Vec<PageBlockingSignals<'_>> = pages
			.iter()
			.map(|page| PageBlockingSignals {
				paths: &page.paths,
				stylesheet_hrefs: &page.hrefs,
			})
			.collect();
		resolve_blocking_group_keys(&signals)
	}

	/// a.css is loaded only by the two dept-a pages (2/4, below the common
	/// cutoff) while common.css is loaded by all 4 (above it).
	fn pages_with_one_common_and_one_distinctive_href() -> Vec<Page> {
		vec![
			page(
				&["dept-a", "news", "1"],
				&[
					"https://example.com/a.css",
					"https://example.com/common.css",
				],
			),
			page(
				&["dept-a", "news", "2"],
				&[
					"https://example.com/a.css",
					"https://example.com/common.css",
				],
			),
			page(&["dept-b", "about"], &["https://example.com/common.css"]),
			page(&["dept-c", "contact"], &["https://example.com/common.css"]),
		]
	}

	#[test]
	fn an_empty_page_list_gives_no_keys() {
		let result = resolve(&[]);
		assert!(result.keys.is_empty());
		assert!(result.reasons.is_empty());
	}

	#[test]
	fn pages_sharing_a_distinctive_stylesheet_get_the_same_css_key() {
		let result = keys(&pages_with_one_common_and_one_distinctive_href());
		assert_eq!(result[0], "css:ac39f3dbf4cdfdbf");
		assert_eq!(result[1], "css:ac39f3dbf4cdfdbf");
	}

	#[test]
	fn a_stylesheet_shared_by_every_page_falls_back_to_the_path_key() {
		let result = keys(&pages_with_one_common_and_one_distinctive_href());
		assert_eq!(result[2], "path:dept-b");
		assert_eq!(result[3], "path:dept-c");
	}

	#[test]
	fn a_stylesheet_common_among_stylesheet_bearing_pages_stays_filtered_when_diluted() {
		// Counting the stylesheet-less pages would read common.css as 2/10
		// and wrongly keep it as distinctive.
		let mut pages = vec![
			page(&["dept-a", "about"], &["https://example.com/common.css"]),
			page(&["dept-b", "about"], &["https://example.com/common.css"]),
		];
		for index in 0..8 {
			pages.push(page(&["dept-c", &format!("page-{index}")], &[]));
		}
		let result = keys(&pages);
		assert_eq!(result[0], "path:dept-a");
		assert_eq!(result[1], "path:dept-b");
	}

	#[test]
	fn pages_sharing_a_multi_href_set_get_the_same_css_key_in_any_order() {
		let result = keys(&[
			page(
				&["dept-a", "news", "1"],
				&["https://example.com/a.css", "https://example.com/b.css"],
			),
			page(
				&["dept-a", "news", "2"],
				&["https://example.com/b.css", "https://example.com/a.css"],
			),
			page(&["dept-b", "about"], &["https://example.com/c.css"]),
		]);
		assert_eq!(result[0], result[1]);
		assert!(result[0].starts_with("css:"));
	}

	#[test]
	fn pages_without_stylesheets_fall_back_to_their_own_path_key() {
		let result = keys(&[page(&["dept-d", "x"], &[]), page(&["dept-e", "y"], &[])]);
		assert_eq!(result, vec!["path:dept-d", "path:dept-e"]);
	}

	#[test]
	fn a_stylesheet_group_of_one_falls_back_to_the_path_key() {
		let result = keys(&[
			page(&["dept-a", "news", "1"], &["https://example.com/a.css"]),
			page(&["dept-b", "about"], &["https://example.com/b.css"]),
			page(&["dept-c", "contact"], &["https://example.com/c.css"]),
		]);
		assert_eq!(result, vec!["path:dept-a", "path:dept-b", "path:dept-c"]);
	}

	#[test]
	fn the_fallback_path_key_is_the_top_level_section_only() {
		let result = keys(&[page(&["dept-a", "news", "1"], &[])]);
		assert_eq!(result, vec!["path:dept-a"]);
	}

	#[test]
	fn a_css_reason_carries_the_exact_distinctive_hrefs_without_the_common_one() {
		let result = resolve(&pages_with_one_common_and_one_distinctive_href());
		assert_eq!(
			result.reasons[&result.keys[0]],
			BlockingReason::Css {
				distinctive_stylesheet_hrefs: vec!["https://example.com/a.css".to_owned()],
			}
		);
	}

	#[test]
	fn a_path_reason_carries_the_path_key_it_fell_back_to() {
		let result = resolve(&pages_with_one_common_and_one_distinctive_href());
		assert_eq!(
			result.reasons["path:dept-b"],
			BlockingReason::Path {
				path_key: "dept-b".to_owned()
			}
		);
		assert_eq!(
			result.reasons["path:dept-c"],
			BlockingReason::Path {
				path_key: "dept-c".to_owned()
			}
		);
	}

	#[test]
	fn there_is_one_reason_per_distinct_key_in_first_appearance_order() {
		let result = resolve(&pages_with_one_common_and_one_distinctive_href());
		assert_eq!(result.keys.len(), 4);
		assert_eq!(
			result
				.reasons
				.keys()
				.map(String::as_str)
				.collect::<Vec<_>>(),
			vec!["css:ac39f3dbf4cdfdbf", "path:dept-b", "path:dept-c"]
		);
	}

	#[test]
	fn a_reason_lists_the_hrefs_in_utf16_order_not_utf8_byte_order() {
		// U+1F600 is the code units D83D DE00, below U+FF61's FF61, so the
		// astral href sorts first, the reverse of the UTF-8 byte order. Two
		// pages share both hrefs; a third keeps them below the 100% cutoff.
		let wide = "https://example.com/\u{FF61}.css";
		let astral = "https://example.com/\u{1F600}.css";
		let result = resolve(&[
			page(&["a", "1"], &[wide, astral]),
			page(&["a", "2"], &[astral, wide]),
			page(&["b"], &["https://example.com/other.css"]),
		]);
		assert_eq!(
			result.reasons[&result.keys[0]],
			BlockingReason::Css {
				distinctive_stylesheet_hrefs: vec![astral.to_owned(), wide.to_owned()],
			}
		);
	}
}
