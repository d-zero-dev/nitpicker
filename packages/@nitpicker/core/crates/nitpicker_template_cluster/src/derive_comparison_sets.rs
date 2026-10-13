use rustc_hash::FxHashMap;

/// Below this many pages a document-frequency split degenerates (a token
/// missing from one page out of `n` stays chrome only while
/// `(n - 1) / n >= 0.9`, i.e. `n >= 10`), so the sets are compared as they
/// are. The same floor gates class stripping and containment.
pub const MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT: usize = 10;

/// A token on at least this fraction of the pages is chrome.
const TEMPLATE_FREQUENCY_THRESHOLD: f64 = 0.9;

/// Absorbs `0.9 * n` landing a hair above the integer it means.
const BOUNDARY_EPSILON: f64 = 1e-9;

/// Narrows each page's set (ascending ids) to its page-specific tokens —
/// those on fewer than 90 % of `sets` — so pages sharing only chrome do not
/// read as alike. A page whose every token is chrome keeps its full set.
#[must_use]
pub fn derive_comparison_sets(sets: &[Vec<u32>]) -> Vec<Vec<u32>> {
	if sets.len() < MIN_PAGE_COUNT_FOR_FREQUENCY_SPLIT {
		return sets.to_vec();
	}
	let mut frequency: FxHashMap<u32, u32> = FxHashMap::default();
	for set in sets {
		for &token in set {
			*frequency.entry(token).or_insert(0) += 1;
		}
	}
	// Page counts stay far below 2^52; the conversion is exact.
	#[allow(clippy::cast_precision_loss)]
	let cutoff = TEMPLATE_FREQUENCY_THRESHOLD * sets.len() as f64 - BOUNDARY_EPSILON;
	sets.iter()
		.map(|set| {
			let content: Vec<u32> = set
				.iter()
				.copied()
				.filter(|token| f64::from(frequency[token]) < cutoff)
				.collect();
			if content.is_empty() && !set.is_empty() {
				set.clone()
			} else {
				content
			}
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::derive_comparison_sets;

	#[test]
	fn keeps_small_pools_unchanged() {
		let sets = vec![vec![1, 2], vec![2, 3]];
		assert_eq!(derive_comparison_sets(&sets), sets);
	}

	#[test]
	fn drops_chrome_tokens_but_never_empties_a_page() {
		let mut sets: Vec<Vec<u32>> = (0..10).map(|page| vec![1, 100 + page]).collect();
		sets.push(vec![1]);
		let derived = derive_comparison_sets(&sets);
		assert_eq!(derived[0], vec![100]);
		assert_eq!(derived[10], vec![1]);
	}

	#[test]
	fn keeps_nine_pages_unchanged_even_with_a_token_on_every_page() {
		let sets: Vec<Vec<u32>> = (0..9).map(|page| vec![1, 100 + page]).collect();
		assert_eq!(derive_comparison_sets(&sets), sets);
	}

	#[test]
	fn removes_tokens_present_on_every_page_from_ten_pages_up() {
		let sets: Vec<Vec<u32>> = (0..10).map(|page| vec![1, 100 + page]).collect();
		let derived = derive_comparison_sets(&sets);
		assert_eq!(derived[0], vec![100]);
		assert_eq!(derived[9], vec![109]);
	}

	#[test]
	fn keeps_the_full_set_when_every_token_is_chrome() {
		let sets: Vec<Vec<u32>> = vec![vec![1]; 10];
		let derived = derive_comparison_sets(&sets);
		assert_eq!(derived[0], vec![1]);
	}
}
