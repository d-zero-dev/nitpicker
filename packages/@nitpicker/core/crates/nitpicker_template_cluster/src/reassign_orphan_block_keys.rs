//! Folding stylesheet-less pages into the `css:` block of their section.
//!
//! `resolve_blocking_group_keys` commits every page to one key, and a page
//! with no stylesheet references can never produce a `css:` candidate, so it
//! always falls back to `path:` — even when every other page of its template
//! loaded a distinctive stylesheet and shares a `css:` key. A crawl that
//! missed some pages' `<link>` data therefore fragments a template. A
//! literal OR-merge would not even apply: an orphan never had a `css:`
//! candidate to merge with. This is the narrower fix for that gap.
//!
//! A `css:` block is a merge target only when *every* member shares one
//! path key ("confined" to that section); a block spanning sections (a
//! shared cross-department template) has no single section to merge into
//! and stays as it is. Non-orphan pages that merely share the orphan's
//! `path:` key (their stylesheet set was genuinely non-discriminative, not
//! unrecorded) are deliberately left out: complete-linkage's minimum-linkage
//! aggregation lets a third point entering a pool change whether two other
//! points merge, so folding in only the confirmed orphans keeps this from
//! perturbing clustering decisions it has no evidence about.
//!
//! This does not compare content. It only decides which pages are pooled
//! for Stage A's per-block clustering to adjudicate; an orphan whose content
//! does not match still ends up in a cluster of its own.
//!
//! Accepted trade-off: "confined" is checked at path-key granularity, so
//! several different-template `css:` blocks sharing one broad section are
//! pooled into one Stage A block, not just beside the orphan that triggered
//! the merge. Pooling can change the merge order of clusters unrelated to
//! any orphan.

use indexmap::{IndexMap, IndexSet};

use crate::derive_path_group_key::derive_path_group_key;
use crate::resolve_blocking_group_keys::PageBlockingSignals;

/// Prefix distinguishing a reassigned key from the `css:`/`path:` keys, so
/// the two families can never collide. The confined path key follows it.
pub const REASSIGNED_KEY_PREFIX: &str = "orphan-merge:";

/// Rewrites the keys of orphans and of the confined `css:` blocks that take
/// them in to `orphan-merge:<pathKey>`; every other key is unchanged.
///
/// An orphan is a page whose key is `path:` and whose stylesheet list is
/// empty. `pages` and `block_keys` are parallel.
///
/// ```text
/// pages:  news/1 {a.css}, news/2 {a.css}, news/3 {}, about {b.css}
/// keys:   css:<a>, css:<a>, path:news, path:about
///      -> orphan-merge:news, orphan-merge:news, orphan-merge:news, path:about
/// ```
#[must_use]
pub fn reassign_orphan_block_keys(
	pages: &[PageBlockingSignals<'_>],
	block_keys: &[String],
) -> Vec<String> {
	let path_keys: Vec<String> = pages
		.iter()
		.map(|page| derive_path_group_key(page.paths))
		.collect();
	let is_orphan = |index: usize| {
		block_keys[index].starts_with("path:") && pages[index].stylesheet_hrefs.is_empty()
	};

	let mut css_member_indices_by_key: IndexMap<&str, Vec<usize>> = IndexMap::new();
	for (index, block_key) in block_keys.iter().enumerate() {
		if block_key.starts_with("css:") {
			css_member_indices_by_key
				.entry(block_key.as_str())
				.or_default()
				.push(index);
		}
	}

	// A css: block is a merge target for path key `p` only when every one
	// of its members shares `p`: one confined path key per block, or none
	// when it spans more than one.
	let mut confined_path_key_by_css_key: IndexMap<&str, &str> = IndexMap::new();
	for (css_key, indices) in &css_member_indices_by_key {
		let candidate = path_keys[indices[0]].as_str();
		if indices
			.iter()
			.all(|&index| path_keys[index].as_str() == candidate)
		{
			confined_path_key_by_css_key.insert(css_key, candidate);
		}
	}

	let path_keys_with_confined_css_block: IndexSet<&str> =
		confined_path_key_by_css_key.values().copied().collect();

	let mut orphan_path_keys: IndexSet<&str> = IndexSet::new();
	for (index, path_key) in path_keys.iter().enumerate() {
		if is_orphan(index) && path_keys_with_confined_css_block.contains(path_key.as_str()) {
			orphan_path_keys.insert(path_key);
		}
	}

	if orphan_path_keys.is_empty() {
		return block_keys.to_vec();
	}

	block_keys
		.iter()
		.enumerate()
		.map(|(index, block_key)| {
			let path_key = path_keys[index].as_str();
			if !orphan_path_keys.contains(path_key) {
				return block_key.clone();
			}
			let is_confined_css_member =
				confined_path_key_by_css_key.get(block_key.as_str()) == Some(&path_key);
			if is_orphan(index) || is_confined_css_member {
				format!("{REASSIGNED_KEY_PREFIX}{path_key}")
			} else {
				block_key.clone()
			}
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::reassign_orphan_block_keys;
	use crate::resolve_blocking_group_keys::{PageBlockingSignals, resolve_blocking_group_keys};

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

	fn signals(pages: &[Page]) -> Vec<PageBlockingSignals<'_>> {
		pages
			.iter()
			.map(|page| PageBlockingSignals {
				paths: &page.paths,
				stylesheet_hrefs: &page.hrefs,
			})
			.collect()
	}

	fn blocking_keys(pages: &[Page]) -> Vec<String> {
		resolve_blocking_group_keys(&signals(pages)).keys
	}

	fn strings(values: &[&str]) -> Vec<String> {
		values.iter().map(|value| (*value).to_owned()).collect()
	}

	#[test]
	fn merges_an_orphan_and_its_confined_block_under_one_key() {
		let pages = [
			page(&["news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2"], &["https://example.com/a.css"]),
			page(&["news", "3"], &[]),
			page(&["about"], &["https://example.com/b.css"]),
		];
		let keys = blocking_keys(&pages);
		assert!(keys[0].starts_with("css:"));
		assert_eq!(keys[2], "path:news");

		assert_eq!(
			reassign_orphan_block_keys(&signals(&pages), &keys),
			strings(&[
				"orphan-merge:news",
				"orphan-merge:news",
				"orphan-merge:news",
				"path:about"
			])
		);
	}

	#[test]
	fn leaves_a_css_block_spanning_two_path_keys_alone() {
		let pages = [
			page(&["news"], &["https://example.com/a.css"]),
			page(&["about"], &["https://example.com/a.css"]),
			page(&["news", "2"], &[]),
			page(&["contact"], &["https://example.com/c.css"]),
		];
		let keys = blocking_keys(&pages);
		assert!(keys[0].starts_with("css:"));
		assert_eq!(keys[0], keys[1]);
		assert_eq!(keys[2], "path:news");

		assert_eq!(reassign_orphan_block_keys(&signals(&pages), &keys), keys);
	}

	#[test]
	fn merges_every_css_block_confined_to_the_same_path_key() {
		let pages = [
			page(&["news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2"], &["https://example.com/a.css"]),
			page(&["news", "3"], &["https://example.com/b.css"]),
			page(&["news", "4"], &["https://example.com/b.css"]),
			page(&["news", "5"], &[]),
		];
		let keys = blocking_keys(&pages);
		assert!(keys[0].starts_with("css:"));
		assert!(keys[2].starts_with("css:"));
		assert_ne!(keys[0], keys[2]);

		assert_eq!(
			reassign_orphan_block_keys(&signals(&pages), &keys),
			strings(&["orphan-merge:news"; 5])
		);
	}

	#[test]
	fn leaves_an_orphan_without_a_confined_block_alone() {
		let pages = [
			page(&["news"], &[]),
			page(&["about"], &["https://example.com/a.css"]),
			page(&["about"], &["https://example.com/a.css"]),
		];
		let keys = strings(&["path:news", "css:x", "css:x"]);
		assert_eq!(reassign_orphan_block_keys(&signals(&pages), &keys), keys);
	}

	#[test]
	fn leaves_a_confined_block_without_an_orphan_alone() {
		let pages = [
			page(&["news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2"], &["https://example.com/a.css"]),
			page(&["contact"], &["https://example.com/c.css"]),
		];
		let keys = blocking_keys(&pages);
		assert!(keys[0].starts_with("css:"));
		assert_eq!(reassign_orphan_block_keys(&signals(&pages), &keys), keys);
	}

	#[test]
	fn does_not_fold_in_a_non_orphan_page_sharing_the_orphan_path_key() {
		// common.css is on every stylesheet-bearing page and filtered out,
		// so page 3 falls back to path:news for a genuine reason; it has a
		// stylesheet, so it is not an orphan and stays out of the pool.
		let pages = [
			page(
				&["news", "1"],
				&[
					"https://example.com/a.css",
					"https://example.com/common.css",
				],
			),
			page(
				&["news", "2"],
				&[
					"https://example.com/a.css",
					"https://example.com/common.css",
				],
			),
			page(&["news", "3"], &[]),
			page(&["news", "4"], &["https://example.com/common.css"]),
			page(&["other", "1"], &["https://example.com/common.css"]),
		];
		let keys = blocking_keys(&pages);
		assert!(keys[0].starts_with("css:"));
		assert_eq!(keys[2], "path:news");
		assert_eq!(keys[3], "path:news");

		let result = reassign_orphan_block_keys(&signals(&pages), &keys);
		assert_eq!(result[0], "orphan-merge:news");
		assert_eq!(result[2], "orphan-merge:news");
		assert_eq!(result[3], "path:news");
	}

	#[test]
	fn an_empty_page_list_gives_an_empty_result() {
		assert_eq!(reassign_orphan_block_keys(&[], &[]), Vec::<String>::new());
	}

	#[test]
	fn a_batch_without_css_keys_is_unchanged() {
		let pages = [page(&["news"], &[]), page(&["about"], &[])];
		let keys = strings(&["path:news", "path:about"]);
		assert_eq!(reassign_orphan_block_keys(&signals(&pages), &keys), keys);
	}

	#[test]
	fn an_orphan_is_judged_by_the_first_non_empty_path_segment() {
		// A leading empty segment and a trailing one change nothing.
		let pages = [
			page(&["", "news", "1"], &["https://example.com/a.css"]),
			page(&["news", "2", ""], &["https://example.com/a.css"]),
			page(&["news", ""], &[]),
			page(&["about"], &["https://example.com/b.css"]),
		];
		let keys = blocking_keys(&pages);
		assert_eq!(
			reassign_orphan_block_keys(&signals(&pages), &keys),
			strings(&[
				"orphan-merge:news",
				"orphan-merge:news",
				"orphan-merge:news",
				"path:about"
			])
		);
	}
}
