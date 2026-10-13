//! A group's shell tokens: the landmark structure nearly every page shares.

use rustc_hash::FxHashMap;

use crate::auto_cut_threshold::auto_cut_threshold;

/// The clamp on the auto-cut over the per-token page frequencies: a shell
/// threshold is never above it. A single distinct token or a perfectly flat
/// distribution gives exactly this, an 80% quorum. Tunable independently of
/// the core quorum fraction (the two are equal because both were validated
/// on the same crawls).
const SHELL_QUORUM_FALLBACK_FRACTION: f64 = 0.8;

/// The shell of a group of pages (ascending ids): the tokens whose page
/// frequency, over the landmark instances of every page, is at or above the
/// max-gap cut of the frequency distribution (the primitive Stage A cuts
/// merge heights with, applied at the landmark-token layer).
///
/// `per_page` lists each page's landmark instances as token slices; a page
/// without any still counts toward the page total.
///
/// ## Why per token, not per signature
///
/// Counting whole instance signatures failed on a common pattern: a shared
/// site header carrying one per-page element (a breadcrumb, a title with a
/// page-specific class). Every page's signature is distinct, so five pages
/// gave five signatures at 0.2 each — a flat distribution that hit the clamp
/// and left the shell empty although every page shared the header skeleton.
/// Per token, the skeleton tokens each reach 1.0.
///
/// ## The histogram
///
/// Each page's instance tokens are unioned into one set (a token in two of
/// the page's landmarks counts once for that page); the histogram is how many
/// pages contain each token. Tokens on nearly every page are the group's
/// chrome; tokens on a handful are page-specific content that happens to sit
/// in a landmark. An auto-cut rather than a fixed quorum, because corpora do
/// not obey one cutoff: a section-local token on 60% of a group's pages is
/// the section's chrome under any reasonable reading, which an 80% quorum
/// would discard.
///
/// A page without landmarks contributes an empty set on purpose: two
/// landmark-less groups then compare as 0, not as 1 (which a fallback to a
/// `<body>`-derived `{body}` set would give both).
#[must_use]
pub fn shell_quorum(per_page: &[Vec<&[u32]>]) -> Vec<u32> {
	let page_count = per_page.len();
	if page_count == 0 {
		return Vec::new();
	}

	// Per token: (pages carrying it, the last page counted), so a token in
	// two instances of one page counts once without a per-page set.
	let mut counts: FxHashMap<u32, (u32, usize)> = FxHashMap::default();
	for (page, instances) in per_page.iter().enumerate() {
		for tokens in instances {
			for &token in *tokens {
				let entry = counts.entry(token).or_insert((0, usize::MAX));
				if entry.1 != page {
					entry.0 += 1;
					entry.1 = page;
				}
			}
		}
	}
	if counts.is_empty() {
		return Vec::new();
	}

	// Page counts stay far below 2^52; the conversions are exact.
	#[allow(clippy::cast_precision_loss)]
	let frequency = |count: u32| f64::from(count) / page_count as f64;
	let frequencies: Vec<f64> = counts
		.values()
		.map(|&(count, _)| frequency(count))
		.collect();
	let cut = auto_cut_threshold(&frequencies, SHELL_QUORUM_FALLBACK_FRACTION);

	let mut shell: Vec<u32> = counts
		.iter()
		.filter(|&(_, &(count, _))| frequency(count) >= cut)
		.map(|(&token, _)| token)
		.collect();
	shell.sort_unstable();
	shell
}

#[cfg(test)]
mod tests {
	use super::shell_quorum;

	/// A page's instances from literal token lists.
	fn page(instances: &[&'static [u32]]) -> Vec<&'static [u32]> {
		instances.to_vec()
	}

	#[test]
	fn no_pages_give_an_empty_shell() {
		assert_eq!(shell_quorum(&[]), Vec::<u32>::new());
	}

	#[test]
	fn pages_without_any_instance_give_an_empty_shell() {
		assert_eq!(
			shell_quorum(&[page(&[]), page(&[]), page(&[])]),
			Vec::<u32>::new()
		);
	}

	#[test]
	fn one_distinct_token_on_every_page_passes_the_fallback_clamp() {
		// One distinct token: `auto_cut_threshold` returns the clamp 0.8
		// verbatim, and frequency 1.0 reaches it.
		let pages: Vec<Vec<&[u32]>> = (0..5).map(|_| page(&[&[7]])).collect();
		assert_eq!(shell_quorum(&pages), vec![7]);
	}

	#[test]
	fn the_documented_gap_distribution_splits_shell_from_noise() {
		// Frequencies {1.00, 1.00, 0.65, 0.03, 0.02}: the widest gap (0.62) is
		// between 0.65 and 0.03, the cut lands at its midpoint (0.34), so the
		// 0.65 token joins the two site-wide ones as shell.
		let with_c: &[u32] = &[1, 2, 3];
		let with_cd: &[u32] = &[1, 2, 3, 4];
		let with_cde: &[u32] = &[1, 2, 3, 4, 5];
		let only_ab: &[u32] = &[1, 2];
		let pages: Vec<Vec<&[u32]>> = (0..100)
			.map(|index| {
				let tokens = match index {
					0..=1 => with_cde,
					2 => with_cd,
					3..=64 => with_c,
					_ => only_ab,
				};
				vec![tokens]
			})
			.collect();
		assert_eq!(shell_quorum(&pages), vec![1, 2, 3]);
	}

	#[test]
	fn a_token_in_two_instances_of_one_page_counts_once_for_that_page() {
		// Page 0 carries token 9 in two instances, page 1 has none. Without
		// the per-page dedupe the count would be 2 (frequency 1.0, shell);
		// with it 1 of 2 = 0.5, below the single-token clamp 0.8.
		let pages = vec![page(&[&[9], &[9]]), page(&[])];
		assert_eq!(shell_quorum(&pages), Vec::<u32>::new());
	}

	#[test]
	fn a_page_without_instances_still_counts_toward_the_page_total() {
		let pages = vec![page(&[&[9]]), page(&[])];
		assert_eq!(shell_quorum(&pages), Vec::<u32>::new());
	}

	#[test]
	fn a_flat_distribution_keeps_the_clamp() {
		// Tokens 1 and 2 both on 3 of 4 pages: no gap, the clamp 0.8 stays and
		// 0.75 falls short of it.
		let pages = vec![
			page(&[&[1, 2]]),
			page(&[&[1, 2]]),
			page(&[&[1, 2]]),
			page(&[]),
		];
		assert_eq!(shell_quorum(&pages), Vec::<u32>::new());
	}

	#[test]
	fn a_shared_skeleton_survives_a_per_page_distinguishing_token() {
		// Five headers share tokens 1 and 2 and each carries its own title
		// token: per token the skeleton is at 1.0, per signature it would be
		// five singletons at 0.2.
		let titles: [&'static [u32]; 5] = [
			&[1, 2, 10],
			&[1, 2, 11],
			&[1, 2, 12],
			&[1, 2, 13],
			&[1, 2, 14],
		];
		let pages: Vec<Vec<&[u32]>> = titles.iter().map(|title| vec![*title]).collect();
		assert_eq!(shell_quorum(&pages), vec![1, 2]);
	}
}
