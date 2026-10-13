//! The coarse path-section key of a page.

/// The first non-empty URL path segment of a page (`paths[0]` after empty
/// segments are dropped), or `""` for the root.
///
/// A blocking key in the record-linkage sense: a cheap partition applied
/// before any structural comparison, not a similarity. Empty segments are
/// dropped anywhere in `paths`, so the trailing `""` a directory-style URL
/// (`/dept-a/`) produces does not split a section from its non-trailing-slash
/// URLs. The depth is fixed at one segment; a deeper section key would
/// fragment sections the classifier treats as one block.
///
/// ```text
/// derive_path_group_key(["dept-a", "news", "123"]) == "dept-a"
/// derive_path_group_key([])                         == ""
/// ```
#[must_use]
pub fn derive_path_group_key(paths: &[String]) -> String {
	paths
		.iter()
		.find(|segment| !segment.is_empty())
		.cloned()
		.unwrap_or_default()
}

#[cfg(test)]
mod tests {
	use super::derive_path_group_key;

	fn paths(segments: &[&str]) -> Vec<String> {
		segments
			.iter()
			.map(|segment| (*segment).to_owned())
			.collect()
	}

	#[test]
	fn a_root_page_has_an_empty_key() {
		assert_eq!(derive_path_group_key(&[]), "");
	}

	#[test]
	fn keeps_only_the_top_level_segment() {
		assert_eq!(
			derive_path_group_key(&paths(&["dept-a", "news", "123"])),
			"dept-a"
		);
	}

	#[test]
	fn a_single_segment_is_its_own_key() {
		assert_eq!(derive_path_group_key(&paths(&["about"])), "about");
	}

	#[test]
	fn a_trailing_empty_segment_does_not_change_the_key() {
		assert_eq!(
			derive_path_group_key(&paths(&["dept-a", ""])),
			derive_path_group_key(&paths(&["dept-a"]))
		);
	}

	#[test]
	fn a_root_made_of_only_an_empty_segment_has_an_empty_key() {
		assert_eq!(derive_path_group_key(&paths(&[""])), "");
	}

	#[test]
	fn a_leading_empty_segment_is_skipped() {
		assert_eq!(
			derive_path_group_key(&paths(&["", "dept-a", "news"])),
			"dept-a"
		);
	}
}
