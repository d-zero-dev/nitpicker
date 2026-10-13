//! A token with its class names stripped: the tag-level skeleton.

/// One path segment without its classes, its `[...]` suffix kept.
///
/// A segment starting with `.` is a tag Stage A wrote without its name
/// (`div` / `span` with classes) and shapes to `*`; any other segment loses
/// everything from its first `.` (`section.c-x` is `section`).
fn shape_segment(segment: &str) -> String {
	let (base, bracket) = match segment.find('[') {
		Some(index) => (&segment[..index], &segment[index..]),
		None => (segment, ""),
	};
	let shaped_base = if base.starts_with('.') {
		"*"
	} else {
		match base.find('.') {
			Some(index) if index > 0 => &base[..index],
			_ => base,
		}
	};
	format!("{shaped_base}{bracket}")
}

/// `token` with the classes stripped from every segment, keeping each
/// bracket suffix. `section.c-page-sub__reports` and
/// `section.c-page-sub__projects` both shape to `section`, exposing the same
/// structural element under different BEM class names: list pages of
/// different sections had class-name similarity 0 and shape similarity 1 on
/// real crawls.
///
/// Splits on every `>`, including one inside a class name or a bracket, as
/// the stored keys were computed.
#[must_use]
pub fn shape_token(token: &str) -> String {
	token
		.split('>')
		.map(shape_segment)
		.collect::<Vec<_>>()
		.join(">")
}

#[cfg(test)]
mod tests {
	use super::shape_token;

	#[test]
	fn a_foldable_segment_with_classes_becomes_a_star() {
		assert_eq!(shape_token(".class1.class2"), "*");
	}

	#[test]
	fn a_non_foldable_segment_with_classes_keeps_its_tag() {
		assert_eq!(shape_token("section.c-reports"), "section");
	}

	#[test]
	fn a_segment_without_classes_is_unchanged() {
		assert_eq!(shape_token("main"), "main");
	}

	#[test]
	fn the_bracket_suffix_survives_the_class_removal() {
		assert_eq!(shape_token("section.c-works[sha=abc]"), "section[sha=abc]");
	}

	#[test]
	fn a_foldable_segment_with_classes_and_a_bracket_keeps_the_bracket() {
		assert_eq!(shape_token(".nav[role=banner]"), "*[role=banner]");
	}

	#[test]
	fn a_bracket_without_a_class_dot_is_unchanged() {
		assert_eq!(shape_token("div[role=dialog]"), "div[role=dialog]");
	}

	#[test]
	fn a_full_path_loses_the_classes_of_each_segment() {
		assert_eq!(
			shape_token("body>main>section.c-works>ul.c-list"),
			"body>main>section>ul"
		);
	}

	#[test]
	fn a_dot_inside_a_bracket_is_not_a_class_separator() {
		// The bracket is cut off before the base is looked at: `.` after `[`
		// belongs to the bracket text.
		assert_eq!(shape_token("svg[sha=a.b]"), "svg[sha=a.b]");
		assert_eq!(shape_token("svg.icon[sha=a.b]"), "svg[sha=a.b]");
	}

	#[test]
	fn a_gt_inside_a_class_name_splits_the_segment_like_any_other() {
		// `.a>b` is one class name `a>b` of a bare div, but the token is
		// split on every `>`: segments `.a` and `b`.
		assert_eq!(shape_token("body>.a>b"), "body>*>b");
	}

	#[test]
	fn an_empty_base_with_a_bracket_is_just_the_bracket() {
		assert_eq!(shape_token("body>[x]"), "body>[x]");
	}
}
