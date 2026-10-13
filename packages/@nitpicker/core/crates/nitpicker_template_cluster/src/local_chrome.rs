use rustc_hash::{FxHashMap, FxHashSet};

use crate::auto_cut_threshold::auto_cut_threshold;
use crate::page::LandmarkInstance;

/// Which landmark instances are local chrome across a pool of pages, and
/// each page's tokens from them.
#[derive(Debug, Default)]
pub struct LocalChrome {
	/// Signatures of the instances that are local chrome.
	pub signatures: FxHashSet<Vec<u32>>,
	/// Per page, the tokens of its local-chrome instances (in instance order).
	pub tokens_by_page: Vec<Vec<u32>>,
}

/// Splits landmark instances into global chrome (on effectively every page:
/// no signal, left cut out) and local chrome (shared by some pages only —
/// a section's own nav), whose tokens go back into those pages' sets.
///
/// The split is the max-gap cut (capped at 0.8) over how many pages carry
/// each instance signature. An instance on a single page is neither: it is
/// per-page variation, and putting it back would split that page off. The
/// tokens go back in full rather than as one marker token, because one
/// token among a hundred moves Jaccard by about 0.01 — not enough to
/// separate pages with and without a section's nav.
#[must_use]
pub fn compute_local_chrome(pages: &[&[LandmarkInstance]]) -> LocalChrome {
	let page_count = pages.len();
	let empty = || LocalChrome {
		signatures: FxHashSet::default(),
		tokens_by_page: vec![Vec::new(); page_count],
	};
	if page_count == 0 {
		return LocalChrome::default();
	}
	let mut counts: FxHashMap<&[u32], usize> = FxHashMap::default();
	for instances in pages {
		for instance in *instances {
			*counts.entry(&instance.signature).or_insert(0) += 1;
		}
	}
	if counts.is_empty() {
		return empty();
	}
	// Page counts stay far below 2^52; the conversions are exact.
	#[allow(clippy::cast_precision_loss)]
	let frequency = |count: usize| count as f64 / page_count as f64;
	let frequencies: Vec<f64> = counts.values().map(|&count| frequency(count)).collect();
	let cut = auto_cut_threshold(&frequencies, 0.8);
	let signatures: FxHashSet<Vec<u32>> = counts
		.iter()
		.filter(|&(_, &count)| count >= 2 && frequency(count) < cut)
		.map(|(signature, _)| signature.to_vec())
		.collect();
	if signatures.is_empty() {
		return empty();
	}
	let tokens_by_page = pages
		.iter()
		.map(|instances| {
			let mut seen = FxHashSet::default();
			let mut tokens = Vec::new();
			for instance in instances
				.iter()
				.filter(|instance| signatures.contains(&instance.signature))
			{
				for &token in &instance.tokens {
					if seen.insert(token) {
						tokens.push(token);
					}
				}
			}
			tokens
		})
		.collect();
	LocalChrome {
		signatures,
		tokens_by_page,
	}
}

#[cfg(test)]
mod tests {
	use super::compute_local_chrome;
	use crate::extract_landmarks::LandmarkType;
	use crate::page::LandmarkInstance;

	fn instance(tokens: &[u32]) -> LandmarkInstance {
		let mut signature = tokens.to_vec();
		signature.sort_unstable();
		LandmarkInstance {
			kind: LandmarkType::Nav,
			tokens: tokens.to_vec(),
			signature,
		}
	}

	#[test]
	fn reinjects_instances_shared_by_some_pages_only() {
		let global = instance(&[1, 2]);
		let local = instance(&[10, 11]);
		let unique = instance(&[20]);
		let pages: Vec<Vec<LandmarkInstance>> = vec![
			vec![global.clone(), local.clone()],
			vec![global.clone(), local.clone()],
			vec![global.clone(), unique],
			vec![global.clone()],
			vec![global],
		];
		let refs: Vec<&[LandmarkInstance]> = pages.iter().map(Vec::as_slice).collect();
		let chrome = compute_local_chrome(&refs);
		assert_eq!(chrome.signatures.len(), 1);
		assert_eq!(
			chrome.tokens_by_page,
			vec![vec![10, 11], vec![10, 11], vec![], vec![], vec![]]
		);
	}
}
