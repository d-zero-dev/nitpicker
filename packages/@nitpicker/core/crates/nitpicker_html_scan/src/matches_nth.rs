/// Whether the 1-based `position` is one of the elements `An+B` selects
/// (`n` ranging over 0, 1, 2, ...). Computed in `f64` like the selector
/// grammar's own arithmetic, so a coefficient too large for an integer gives
/// the same answer it would there.
///
/// # Examples
///
/// ```
/// use nitpicker_html_scan::matches_nth;
///
/// assert!(matches_nth(3, 2.0, 1.0)); // 2n+1
/// assert!(!matches_nth(2, 2.0, 1.0));
/// assert!(matches_nth(5, 0.0, 5.0)); // :nth-child(5)
/// ```
#[must_use]
pub fn matches_nth(position: u32, a: f64, b: f64) -> bool {
	if a == 0.0 {
		// Exact, like the grammar's `position === b`: both sides are integers.
		return f64::from(position) - b == 0.0;
	}
	let n = (f64::from(position) - b) / a;
	n.is_finite() && n - n.trunc() == 0.0 && n >= 0.0
}

#[cfg(test)]
mod tests {
	use super::matches_nth;

	#[test]
	fn a_zero_coefficient_selects_one_position() {
		assert!(matches_nth(1, 0.0, 1.0));
		assert!(!matches_nth(2, 0.0, 1.0));
	}

	#[test]
	fn selects_every_step_from_the_offset() {
		assert!(matches_nth(1, 2.0, 1.0));
		assert!(matches_nth(5, 2.0, 1.0));
		assert!(!matches_nth(4, 2.0, 1.0));
		assert!(matches_nth(2, 2.0, 0.0));
		assert!(!matches_nth(1, 2.0, 2.0));
	}

	#[test]
	fn a_negative_coefficient_counts_down_to_the_offset() {
		assert!(matches_nth(1, -1.0, 3.0));
		assert!(matches_nth(3, -1.0, 3.0));
		assert!(!matches_nth(4, -1.0, 3.0));
	}

	#[test]
	fn a_huge_coefficient_selects_only_the_offset() {
		assert!(matches_nth(3, 1e300, 3.0));
		assert!(!matches_nth(4, 1e300, 3.0));
	}

	#[test]
	fn selects_the_positions_the_selector_grammar_does() {
		let cases: [(u32, f64, f64, bool); 17] = [
			(1, 0.0, 1.0, true),
			(2, 0.0, 1.0, false),
			(0, 0.0, 0.0, true),
			(3, 2.0, 1.0, true),
			(4, 2.0, 1.0, false),
			(2, 2.0, 0.0, true),
			(1, 2.0, 0.0, false),
			(1, 1.0, 2.0, false),
			(2, 1.0, 2.0, true),
			(9, 1.0, 2.0, true),
			(1, -1.0, 3.0, true),
			(3, -1.0, 3.0, true),
			(4, -1.0, 3.0, false),
			(2, 3.0, -1.0, true),
			(5, 3.0, -1.0, true),
			(3, 3.0, -1.0, false),
			(1, 3.0, -1.0, false),
		];
		for (position, a, b, expected) in cases {
			assert_eq!(
				matches_nth(position, a, b),
				expected,
				"{position} against {a}n+{b}"
			);
		}
	}
}
