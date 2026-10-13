//! The evidence behind one Pass-0 block key.

use crate::js_string::json_string;

/// Which signal decided a block key, carried verbatim. Every page sharing a
/// `css:<hash>` key shares the exact same stylesheet set by construction
/// (the hash derives from it), so one reason per distinct block key is
/// enough.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockingReason {
	/// A `css:` key. `distinctive_stylesheet_hrefs` is the sorted,
	/// deduplicated, first-party set left after corpus-wide chrome removal:
	/// the exact set hashed into the key.
	Css {
		distinctive_stylesheet_hrefs: Vec<String>,
	},
	/// A `path:` key: the page fell back to its URL path section.
	Path { path_key: String },
	/// An `orphan-merge:` key: stylesheet-less pages folded into a
	/// same-section `css:` block. `path_key` is the confined section.
	OrphanMerge { path_key: String },
}

impl BlockingReason {
	/// `JSON.stringify` of the reason as an object, fields in the order the
	/// reason objects are built: `kind` first.
	///
	/// ```text
	/// {"kind":"css","distinctiveStylesheetHrefs":["https://example.com/a.css"]}
	/// {"kind":"path","pathKey":"about"}
	/// {"kind":"orphanMerge","pathKey":"news"}
	/// ```
	#[must_use]
	pub fn to_json(&self) -> String {
		match self {
			Self::Css {
				distinctive_stylesheet_hrefs,
			} => {
				let hrefs: Vec<String> = distinctive_stylesheet_hrefs
					.iter()
					.map(|href| json_string(href))
					.collect();
				format!(
					"{{\"kind\":\"css\",\"distinctiveStylesheetHrefs\":[{}]}}",
					hrefs.join(",")
				)
			}
			Self::Path { path_key } => {
				format!(
					"{{\"kind\":\"path\",\"pathKey\":{}}}",
					json_string(path_key)
				)
			}
			Self::OrphanMerge { path_key } => {
				format!(
					"{{\"kind\":\"orphanMerge\",\"pathKey\":{}}}",
					json_string(path_key)
				)
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::BlockingReason;

	#[test]
	fn serializes_each_variant_with_kind_first() {
		assert_eq!(
			BlockingReason::Css {
				distinctive_stylesheet_hrefs: vec![
					"https://example.com/a.css".to_owned(),
					"https://example.com/b\"c.css".to_owned(),
				],
			}
			.to_json(),
			"{\"kind\":\"css\",\"distinctiveStylesheetHrefs\":[\"https://example.com/a.css\",\"https://example.com/b\\\"c.css\"]}"
		);
		assert_eq!(
			BlockingReason::Path {
				path_key: "about".to_owned()
			}
			.to_json(),
			"{\"kind\":\"path\",\"pathKey\":\"about\"}"
		);
		assert_eq!(
			BlockingReason::OrphanMerge {
				path_key: String::new()
			}
			.to_json(),
			"{\"kind\":\"orphanMerge\",\"pathKey\":\"\"}"
		);
	}

	#[test]
	fn serializes_an_empty_css_set_as_an_empty_array() {
		assert_eq!(
			BlockingReason::Css {
				distinctive_stylesheet_hrefs: Vec::new()
			}
			.to_json(),
			"{\"kind\":\"css\",\"distinctiveStylesheetHrefs\":[]}"
		);
	}
}
