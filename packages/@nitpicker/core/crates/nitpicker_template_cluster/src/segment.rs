//! Path segments: how one element reads inside a token.

/// `div` / `span`: generic wrappers whose name gives way to their classes
/// (`.card`, not `div.card`), and which drop out of a path entirely when
/// they are bare and have a single element child.
#[must_use]
pub fn is_foldable_tag(tag: &str) -> bool {
	tag == "div" || tag == "span"
}

/// `[role=…,type=…]` (keys in this fixed order, which is also their sorted
/// order), or nothing without either.
fn push_bracket(out: &mut String, entries: &[(&str, Option<&str>)]) {
	let mut first = true;
	for (key, value) in entries {
		let Some(value) = value else {
			continue;
		};
		out.push(if first { '[' } else { ',' });
		first = false;
		out.push_str(key);
		out.push('=');
		out.push_str(value);
	}
	if !first {
		out.push(']');
	}
}

/// One element's segment: the tag (or, for `div` / `span` with classes,
/// just the classes), its classes joined with `.`, and `role` / `type` as a
/// bracket suffix kept apart from the classes so a class named `button`
/// cannot read as `type=button`.
#[must_use]
pub fn build_segment(
	tag: &str,
	classes: &[&str],
	role: Option<&str>,
	r#type: Option<&str>,
) -> String {
	let mut out = String::new();
	if classes.is_empty() {
		out.push_str(tag);
	} else {
		if !is_foldable_tag(tag) {
			out.push_str(tag);
		}
		for class in classes {
			out.push('.');
			out.push_str(class);
		}
	}
	push_bracket(&mut out, &[("role", role), ("type", r#type)]);
	out
}

/// The leaf segment standing for a whole opaque element, identified by its
/// content hash instead of its markup.
#[must_use]
pub fn build_opaque_segment(
	tag: &str,
	role: Option<&str>,
	r#type: Option<&str>,
	sha: &str,
) -> String {
	let mut out = String::from(tag);
	push_bracket(
		&mut out,
		&[("role", role), ("sha", Some(sha)), ("type", r#type)],
	);
	out
}

/// Whether an element may fold away: a bare `div` / `span` (no class, role
/// or type left).
#[must_use]
pub fn is_fold_candidate(
	tag: &str,
	classes: &[&str],
	role: Option<&str>,
	r#type: Option<&str>,
) -> bool {
	is_foldable_tag(tag) && classes.is_empty() && role.is_none() && r#type.is_none()
}

#[cfg(test)]
mod tests {
	use super::{build_opaque_segment, build_segment, is_fold_candidate, push_bracket};

	#[test]
	fn replaces_a_wrapper_tag_with_its_classes() {
		assert_eq!(build_segment("div", &["a", "b"], None, None), ".a.b");
		assert_eq!(build_segment("ul", &["nav"], None, None), "ul.nav");
		assert_eq!(build_segment("div", &[], None, None), "div");
	}

	#[test]
	fn appends_role_and_type_in_a_bracket() {
		assert_eq!(
			build_segment("button", &["x"], Some("tab"), Some("submit")),
			"button.x[role=tab,type=submit]"
		);
		assert_eq!(
			build_segment("input", &[], None, Some("text")),
			"input[type=text]"
		);
	}

	#[test]
	fn names_an_opaque_element_by_its_hash() {
		assert_eq!(
			build_opaque_segment("svg", Some("img"), None, "0123456789abcdef"),
			"svg[role=img,sha=0123456789abcdef]"
		);
		assert_eq!(
			build_opaque_segment("script", None, Some("module"), "f"),
			"script[sha=f,type=module]"
		);
	}

	#[test]
	fn folds_only_bare_wrappers() {
		assert!(is_fold_candidate("span", &[], None, None));
		assert!(!is_fold_candidate("span", &["a"], None, None));
		assert!(!is_fold_candidate("div", &[], Some("main"), None));
		assert!(!is_fold_candidate("section", &[], None, None));
	}

	#[test]
	fn drops_the_tag_name_of_div_and_span_with_classes() {
		assert_eq!(
			build_segment("div", &["card", "featured"], None, None),
			".card.featured"
		);
		assert_eq!(build_segment("span", &["icon"], None, None), ".icon");
	}

	#[test]
	fn keeps_the_tag_name_of_div_and_span_without_classes() {
		assert_eq!(build_segment("div", &[], None, None), "div");
		assert_eq!(build_segment("span", &[], None, None), "span");
	}

	#[test]
	fn always_keeps_the_tag_name_of_other_tags() {
		assert_eq!(build_segment("ul", &["list"], None, None), "ul.list");
		assert_eq!(build_segment("ul", &[], None, None), "ul");
	}

	#[test]
	fn appends_role_as_a_bracket_suffix() {
		assert_eq!(
			build_segment("div", &["card"], Some("button"), None),
			".card[role=button]"
		);
	}

	#[test]
	fn appends_type_as_a_bracket_suffix() {
		assert_eq!(
			build_segment("input", &[], None, Some("checkbox")),
			"input[type=checkbox]"
		);
	}

	#[test]
	fn combines_role_and_type_in_one_bracket_in_key_order() {
		assert_eq!(
			build_segment("input", &[], Some("switch"), Some("checkbox")),
			"input[role=switch,type=checkbox]"
		);
	}

	#[test]
	fn preserves_a_tailwind_arbitrary_value_class_verbatim() {
		assert_eq!(
			build_segment("div", &["w-[137px]"], None, None),
			".w-[137px]"
		);
		assert_eq!(
			build_segment("div", &["w-[137px]"], Some("button"), None),
			".w-[137px][role=button]"
		);
	}

	#[test]
	fn formats_an_empty_bracket_as_nothing() {
		let mut out = String::new();
		push_bracket(&mut out, &[("role", None), ("type", None)]);
		assert_eq!(out, "");
	}

	#[test]
	fn formats_a_single_bracket_attribute() {
		let mut out = String::new();
		push_bracket(&mut out, &[("role", Some("button")), ("type", None)]);
		assert_eq!(out, "[role=button]");
	}

	#[test]
	fn formats_role_sha_and_type_together_in_key_order() {
		let mut out = String::new();
		push_bracket(
			&mut out,
			&[
				("role", Some("img")),
				("sha", Some("abcd1234ef567890")),
				("type", None),
			],
		);
		assert_eq!(out, "[role=img,sha=abcd1234ef567890]");
	}

	#[test]
	fn treats_div_span_with_class_less_role_less_type_less_as_candidates_and_nothing_else() {
		assert!(is_fold_candidate("div", &[], None, None));
		assert!(!is_fold_candidate("div", &["card"], None, None));
		assert!(!is_fold_candidate("span", &[], None, Some("text")));
		assert!(!is_fold_candidate("ul", &[], None, None));
		assert!(!is_fold_candidate("li", &[], None, None));
	}
}
