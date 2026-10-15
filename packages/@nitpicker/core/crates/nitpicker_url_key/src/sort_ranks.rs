use rayon::prelude::*;

use crate::build_url_sort_key::build_url_sort_key;

/// Ranks every URL in natural URL order: the result holds, for each input
/// position, the position that URL takes in the sorted list.
///
/// Identical URLs (and URLs whose keys tie otherwise — none can, the key
/// ends in the raw string) rank in input order, so the ranks are a
/// permutation of `0..urls.len()` and never depend on how the work was
/// split across threads. Keys are built and sorted on rayon's pool.
///
/// # Panics
///
/// Panics when there are more than `u32::MAX` URLs.
///
/// # Examples
///
/// ```
/// let ranks = nitpicker_url_key::sort_ranks(&[
///     "https://example.com/page10",
///     "https://example.com/page2",
/// ]);
/// assert_eq!(ranks, [1, 0]);
/// ```
#[must_use]
pub fn sort_ranks<S: AsRef<str> + Sync>(urls: &[S]) -> Vec<u32> {
	assert!(
		u32::try_from(urls.len()).is_ok(),
		"more URLs than u32 ranks can address"
	);
	let keys: Vec<Vec<u8>> = urls
		.par_iter()
		.map(|url| build_url_sort_key(url.as_ref()))
		.collect();
	let mut order: Vec<u32> = (0..urls.len())
		.map(|index| u32::try_from(index).unwrap_or(u32::MAX))
		.collect();
	order.par_sort_unstable_by(|&a, &b| {
		keys[a as usize]
			.cmp(&keys[b as usize])
			.then_with(|| a.cmp(&b))
	});
	let mut ranks = vec![0_u32; urls.len()];
	for (rank, &index) in order.iter().enumerate() {
		ranks[index as usize] = u32::try_from(rank).unwrap_or(u32::MAX);
	}
	ranks
}
