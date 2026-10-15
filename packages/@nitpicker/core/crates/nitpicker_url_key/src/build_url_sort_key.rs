use crate::parse_url::parse_url;
use crate::push_text::push_text;

/// A path ends here (sorts before every segment).
const PATH_END: u8 = 0x00;
/// The last segment is empty: the URL ends in a slash, a directory listing.
const SEGMENT_DIRECTORY: u8 = 0x01;
/// The last segment is an index page: `index` alone or with one extension
/// (`index.html`, `Index.php`).
const SEGMENT_INDEX: u8 = 0x02;
/// The last segment merely starts with `index` (`index-j.html`, `index2.html`).
const SEGMENT_INDEX_LIKE: u8 = 0x03;
/// Any other segment, whether a directory on the way or the final file.
const SEGMENT_NAME: u8 = 0x04;

/// Builds the sort key of one URL: bytes whose `memcmp` order is the natural
/// URL order the viewer lists in. The order is defined in the crate docs.
///
/// Two URLs get the same key only when their strings are identical, because
/// the raw string (as UTF-8) closes the key. A key takes about three times
/// the URL's length: the host, path, query and fragment as UTF-16 (their
/// parts add up to roughly the URL), plus the raw string.
#[must_use]
pub fn build_url_sort_key(url: &str) -> Vec<u8> {
	let parsed = parse_url(url);
	let mut key = Vec::with_capacity(url.len() * 3 + 16);
	push_text(&mut key, &parsed.hostname, false);
	push_path(&mut key, &parsed.segments);
	push_text(&mut key, &parsed.search, true);
	push_text(&mut key, &parsed.hash, true);
	push_text(&mut key, &parsed.protocol, false);
	key.extend_from_slice(url.as_bytes());
	key
}

/// Appends the path: each segment behind a class byte, then [`PATH_END`].
///
/// The class byte decides the order before any text is read, which puts a
/// directory's own page (`/a/`) and its index pages ahead of everything
/// below it, and a path ahead of the longer paths it starts.
fn push_path(key: &mut Vec<u8>, segments: &[String]) {
	let last = segments.len().saturating_sub(1);
	for (position, segment) in segments.iter().enumerate() {
		let is_last = position == last;
		if is_last && segment.is_empty() {
			key.push(SEGMENT_DIRECTORY);
			continue;
		}
		key.push(if is_last {
			last_segment_class(segment)
		} else {
			SEGMENT_NAME
		});
		push_text(key, segment, true);
	}
	key.push(PATH_END);
}

/// The class of a non-empty last segment.
fn last_segment_class(segment: &str) -> u8 {
	let lowered = segment.to_lowercase();
	if lowered == "index"
		|| lowered
			.strip_prefix("index.")
			.is_some_and(|ext| !ext.contains('.'))
	{
		SEGMENT_INDEX
	} else if lowered.starts_with("index") {
		SEGMENT_INDEX_LIKE
	} else {
		SEGMENT_NAME
	}
}

#[cfg(test)]
mod tests {
	use super::last_segment_class;

	#[test]
	fn recognizes_an_index_page_by_its_name_and_one_extension() {
		assert_eq!(last_segment_class("index"), 0x02);
		assert_eq!(last_segment_class("Index.HTML"), 0x02);
		assert_eq!(last_segment_class("index."), 0x02);
	}

	#[test]
	fn treats_other_names_starting_with_index_as_index_like() {
		assert_eq!(last_segment_class("index-j.html"), 0x03);
		assert_eq!(last_segment_class("index2.html"), 0x03);
		assert_eq!(last_segment_class("index.tar.gz"), 0x03);
	}

	#[test]
	fn treats_everything_else_as_a_name() {
		assert_eq!(last_segment_class("about.html"), 0x04);
		assert_eq!(last_segment_class("reindex"), 0x04);
	}
}
