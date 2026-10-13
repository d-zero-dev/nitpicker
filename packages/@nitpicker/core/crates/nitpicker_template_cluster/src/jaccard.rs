/// How many ids two ascending, duplicate-free lists share.
#[must_use]
pub fn intersection_size(a: &[u32], b: &[u32]) -> usize {
	let (mut i, mut j, mut shared) = (0, 0, 0);
	while i < a.len() && j < b.len() {
		match a[i].cmp(&b[j]) {
			std::cmp::Ordering::Less => i += 1,
			std::cmp::Ordering::Greater => j += 1,
			std::cmp::Ordering::Equal => {
				shared += 1;
				i += 1;
				j += 1;
			}
		}
	}
	shared
}

/// Jaccard similarity of two ascending, duplicate-free id lists; two empty
/// sets are identical (`1`).
#[must_use]
pub fn jaccard(a: &[u32], b: &[u32]) -> f64 {
	if a.is_empty() && b.is_empty() {
		return 1.0;
	}
	let shared = intersection_size(a, b);
	let union = a.len() + b.len() - shared;
	// Counts stay far below 2^52, so the conversions are exact.
	#[allow(clippy::cast_precision_loss)]
	let similarity = shared as f64 / union as f64;
	similarity
}

/// `ids` ascending without duplicates — the form [`jaccard`] compares.
#[must_use]
pub fn sorted_set(ids: &[u32]) -> Vec<u32> {
	let mut sorted = ids.to_vec();
	sorted.sort_unstable();
	sorted.dedup();
	sorted
}

// Exact float comparisons on purpose: the stored keys depend on these
// values bit for bit, not approximately.
#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
	use super::{intersection_size, jaccard, sorted_set};

	#[test]
	fn divides_the_shared_count_by_the_union() {
		assert_eq!(jaccard(&[1, 2, 3], &[2, 3, 4]), 0.5);
		assert_eq!(jaccard(&[], &[]), 1.0);
		assert_eq!(jaccard(&[1], &[]), 0.0);
		assert_eq!(intersection_size(&[1, 5, 9], &[5, 9, 12]), 2);
	}

	#[test]
	fn sorts_and_dedupes() {
		assert_eq!(sorted_set(&[3, 1, 3, 2]), vec![1, 2, 3]);
	}
}
