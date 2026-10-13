use std::borrow::Cow;

/// `String.prototype.toLowerCase`: ASCII is folded in place, anything else
/// goes through Unicode's full lower-case mapping (which, like JavaScript,
/// handles `İ` → `i̇` and the final-sigma context).
#[must_use]
pub fn to_lower_case_js(value: &str) -> Cow<'_, str> {
	if value.is_ascii() {
		if value.bytes().any(|byte| byte.is_ascii_uppercase()) {
			return Cow::Owned(value.to_ascii_lowercase());
		}
		return Cow::Borrowed(value);
	}
	let lowered = value.to_lowercase();
	if lowered == value {
		Cow::Borrowed(value)
	} else {
		Cow::Owned(lowered)
	}
}

#[cfg(test)]
mod tests {
	use super::to_lower_case_js;

	#[test]
	fn folds_ascii_and_borrows_when_unchanged() {
		assert_eq!(to_lower_case_js("DiV"), "div");
		assert!(matches!(
			to_lower_case_js("div"),
			std::borrow::Cow::Borrowed(_)
		));
	}

	#[test]
	fn applies_unicode_special_casing_like_javascript() {
		assert_eq!(to_lower_case_js("\u{130}"), "i\u{307}");
		// Final sigma: the last Σ lowers to ς (U+03C2), the others to σ.
		assert_eq!(to_lower_case_js("ΣΟΣ"), "\u{3c3}\u{3bf}\u{3c2}");
	}
}
