use memchr::memchr2;

/// The first position at or after `from` where `needle` occurs in
/// `haystack`, comparing ASCII letters without regard to case. `needle` is
/// lower-case.
fn find_ignoring_ascii_case(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
	let Some(&first) = needle.first() else {
		return Some(from);
	};
	let upper = first.to_ascii_uppercase();
	let mut at = from;
	while let Some(offset) = haystack
		.get(at..)
		.and_then(|rest| memchr2(first, upper, rest))
	{
		let found = at + offset;
		if haystack
			.get(found..found + needle.len())
			.is_some_and(|candidate| candidate.eq_ignore_ascii_case(needle))
		{
			return Some(found);
		}
		at = found + 1;
	}
	None
}

/// Checks that every literal occurs in the document, each after the
/// previous one — a necessary condition for a selector whose compounds are
/// ancestor-first, since an ancestor's start tag precedes its descendant's.
///
/// Taking the leftmost occurrence of each literal in turn is optimal (it
/// leaves the most room for the rest), so a greedy search decides this
/// without backtracking, in time linear in the document plus the literals.
/// Letters compare without regard to ASCII case, and only ASCII case: the
/// literals are printable ASCII, so a non-ASCII letter in the document can
/// never stand in for one.
///
/// `literals` are lower-case; `None` means no constraint.
///
/// # Examples
///
/// ```
/// use nitpicker_html_scan::passes_ordered_prefilter;
///
/// let literals = [b"<nav".to_vec(), b"<a".to_vec()];
/// assert!(passes_ordered_prefilter(b"<NAV><a href=/x>", Some(&literals)));
/// assert!(!passes_ordered_prefilter(b"<a><nav>", Some(&literals)));
/// ```
#[must_use]
pub fn passes_ordered_prefilter(html: &[u8], literals: Option<&[Vec<u8>]>) -> bool {
	let Some(literals) = literals else {
		return true;
	};
	let mut position = 0;
	for literal in literals {
		let Some(found) = find_ignoring_ascii_case(html, literal, position) else {
			return false;
		};
		position = found + literal.len();
	}
	true
}

#[cfg(test)]
mod tests {
	use super::passes_ordered_prefilter;

	fn passes(html: &str, literals: Option<&[&str]>) -> bool {
		let owned: Option<Vec<Vec<u8>>> =
			literals.map(|list| list.iter().map(|l| l.as_bytes().to_vec()).collect());
		passes_ordered_prefilter(html.as_bytes(), owned.as_deref())
	}

	#[test]
	fn no_literals_is_no_constraint() {
		assert!(passes("", None));
		assert!(passes("", Some(&[])));
	}

	#[test]
	fn needs_every_literal_in_order() {
		assert!(passes("<nav><a href=\"/x\">", Some(&["<nav", "<a"])));
		assert!(!passes("<a><nav>", Some(&["<nav", "<a"])));
		assert!(!passes("<nav>", Some(&["<nav", "<a"])));
	}

	#[test]
	fn a_literal_may_not_overlap_the_previous_one() {
		assert!(!passes("<a", Some(&["<a", "a"])));
		assert!(passes("<aa", Some(&["<a", "a"])));
	}

	#[test]
	fn ignores_ascii_case_in_the_document() {
		assert!(passes("<NAV><A HREF=x>", Some(&["<nav", "href"])));
	}

	#[test]
	fn does_not_fold_non_ascii_letters_into_ascii() {
		assert!(!passes("<lin\u{212a}>", Some(&["<link"])));
		assert!(!passes("\u{130}n", Some(&["in"])));
	}

	#[test]
	fn an_empty_document_passes_only_without_literals() {
		assert!(!passes("", Some(&["a"])));
	}

	#[test]
	fn does_not_reuse_the_same_text_for_two_literals() {
		assert!(!passes("<a>", Some(&["<a", "<a"])));
		assert!(passes("<a><a>", Some(&["<a", "<a"])));
	}

	#[test]
	fn takes_the_leftmost_occurrence_which_leaves_the_most_room() {
		assert!(passes("<a><a><b>", Some(&["<a", "<b"])));
		assert!(!passes("<b><a><a>", Some(&["<a", "<b"])));
	}

	#[test]
	fn answers_fast_when_an_early_literal_is_everywhere_and_the_last_is_missing() {
		let html = "<a>".repeat(300_000);
		assert!(!passes(&html, Some(&["<a", "<a", "<a", "<a", "<a", "<z"])));
	}
}
