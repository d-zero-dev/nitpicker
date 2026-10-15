//! The order as examples: each case lists URLs in the order they must sort,
//! and the test sorts them from the reverse and from a rotation.

use nitpicker_url_key::sort_ranks;

/// Asserts `expected` is already in sorted order, whatever order it arrives in.
fn assert_sorts_as(name: &str, expected: &[&str]) {
	let identity: Vec<u32> = (0..u32::try_from(expected.len()).unwrap()).collect();
	assert_eq!(sort_ranks(expected), identity, "{name}: as listed");

	let reversed: Vec<&str> = expected.iter().rev().copied().collect();
	let mut expected_for_reversed = identity.clone();
	expected_for_reversed.reverse();
	assert_eq!(
		sort_ranks(&reversed),
		expected_for_reversed,
		"{name}: reversed"
	);

	let mut rotated = expected.to_vec();
	rotated.rotate_left(expected.len() / 2);
	let ranks = sort_ranks(&rotated);
	let mut resorted = vec![""; expected.len()];
	for (position, rank) in ranks.iter().enumerate() {
		resorted[*rank as usize] = rotated[position];
	}
	assert_eq!(resorted, expected, "{name}: rotated");
}

#[test]
fn numbers_in_path_segments_compare_by_value() {
	assert_sorts_as(
		"numbers",
		&[
			"https://example.com/page1",
			"https://example.com/page2",
			"https://example.com/page10",
			"https://example.com/page100",
		],
	);
}

#[test]
fn the_trio_that_had_no_consistent_order_is_ordered() {
	assert_sorts_as(
		"trio",
		&[
			"https://example.com/a1x",
			"https://example.com/a9",
			"https://example.com/a10",
		],
	);
}

#[test]
fn a_directory_comes_before_its_index_pages_and_its_children() {
	assert_sorts_as(
		"directory",
		&[
			"https://example.com/a",
			"https://example.com/a/",
			"https://example.com/a/index.html",
			"https://example.com/a/index.php",
			"https://example.com/a/b/",
			"https://example.com/a/b.html",
		],
	);
}

#[test]
fn index_pages_of_different_names_have_one_consistent_order() {
	assert_sorts_as(
		"index",
		&[
			"https://example.com/index.html",
			"https://example.com/index.php",
			"https://example.com/index2.html",
		],
	);
}

#[test]
fn index_classes_apply_to_the_last_segment_only() {
	assert_sorts_as(
		"index-last",
		&[
			"https://example.com/index.html",
			"https://example.com/about/x",
			"https://example.com/index/x",
			"https://example.com/zoo/x",
		],
	);
}

#[test]
fn port_and_credentials_order_by_the_raw_string() {
	assert_sorts_as(
		"port",
		&[
			"https://example.com/a",
			"https://example.com:8080/a",
			"https://user:pass@example.com/a",
		],
	);
}

#[test]
fn percent_encoded_capitals_fold_like_written_ones() {
	let ranks = sort_ranks(&["https://example.com/a%42", "https://example.com/ab"]);
	// Equal after folding; the raw string decides, and `%` sorts before `a`.
	assert_eq!(ranks, [0, 1]);
}

#[test]
fn leading_zeros_do_not_change_the_value_and_equal_values_order_as_strings() {
	assert_sorts_as(
		"zeros",
		&[
			"https://example.com/p/0",
			"https://example.com/p/00",
			"https://example.com/p/001",
			"https://example.com/p/01",
			"https://example.com/p/1",
			"https://example.com/p/2",
		],
	);
}

#[test]
fn a_plain_index_page_comes_before_names_that_only_start_with_index() {
	assert_sorts_as(
		"index-like",
		&[
			"https://example.com/a/",
			"https://example.com/a/index.html",
			"https://example.com/a/index.php",
			"https://example.com/a/index-j.html",
			"https://example.com/a/index2.html",
			"https://example.com/a/about.html",
		],
	);
}

#[test]
fn a_number_in_a_mixed_name_is_not_read_as_an_exponent() {
	assert_sorts_as(
		"exponent-like",
		&[
			"https://example.com/r1e2.pdf",
			"https://example.com/r1e10.pdf",
			"https://example.com/r2e1.pdf",
		],
	);
}

#[test]
fn decimals_and_exponents_are_not_numbers() {
	assert_sorts_as(
		"decimals",
		&[
			"https://example.com/v1.2",
			"https://example.com/v1.10",
			"https://example.com/v2.1",
		],
	);
	assert_sorts_as(
		"exponent",
		&["https://example.com/v1e3", "https://example.com/v1e10"],
	);
}

#[test]
fn case_does_not_split_the_order() {
	assert_sorts_as(
		"case",
		&[
			"https://example.com/Apple",
			"https://example.com/banana",
			"https://example.com/Cherry",
		],
	);
}

#[test]
fn percent_escapes_sort_as_the_character_they_encode() {
	assert_sorts_as(
		"escapes",
		&[
			"https://example.com/z",
			"https://example.com/%E3%81%82",
			"https://example.com/%E3%81%84",
		],
	);
}

#[test]
fn queries_compare_after_the_path_and_ignore_parameter_order() {
	assert_sorts_as(
		"query",
		&[
			"https://example.com/p",
			"https://example.com/p?a=1",
			"https://example.com/p?a=2",
			"https://example.com/p?a=10",
			"https://example.com/p?a=10&b=1",
		],
	);
	// Normalized to `a=9&b=1` and `a=9&b=2`: ordered by value, not by which
	// parameter was written first.
	let ranks = sort_ranks(&[
		"https://example.com/p?b=1&a=9",
		"https://example.com/p?a=9&b=2",
	]);
	assert_eq!(ranks, [0, 1]);
	// The same query written in two orders is one query; the raw string decides.
	let ranks = sort_ranks(&[
		"https://example.com/p?b=1&a=2",
		"https://example.com/p?a=2&b=1",
	]);
	assert_eq!(ranks, [1, 0]);
}

#[test]
fn a_session_id_does_not_split_otherwise_equal_urls() {
	let ranks = sort_ranks(&[
		"https://example.com/p?PHPSESSID=zzz&a=1",
		"https://example.com/p?a=1",
	]);
	// Equal after normalizing; the raw string decides, and `P` sorts before `a`.
	assert_eq!(ranks, [0, 1]);
}

#[test]
fn hosts_compare_before_paths() {
	assert_sorts_as(
		"hosts",
		&[
			"https://a.example.com/z",
			"https://b.example.com/a",
			"https://b.example.net/a",
		],
	);
}

#[test]
fn non_ascii_hosts_compare_by_their_ascii_form() {
	let ranks = sort_ranks(&["https://日本語.example/", "https://a.example/"]);
	assert_eq!(ranks, [1, 0]);
}

#[test]
fn credentials_do_not_change_the_position_among_other_urls() {
	assert_sorts_as(
		"credentials",
		&[
			"https://example.com/a",
			"https://user:pass@example.com/b",
			"https://example.com/c",
		],
	);
}

#[test]
fn fragments_come_after_queries() {
	assert_sorts_as(
		"fragments",
		&[
			"https://example.com/p",
			"https://example.com/p#a",
			"https://example.com/p#b",
		],
	);
}

#[test]
fn urls_that_are_not_http_sort_ahead_of_http_urls() {
	assert_sorts_as(
		"non-http",
		&[
			"not a url",
			"mailto:someone@example.com",
			"tel:0123456789",
			"https://a.example.com/",
		],
	);
}

#[test]
fn identical_urls_rank_in_input_order() {
	let ranks = sort_ranks(&[
		"https://example.com/a",
		"https://example.com/a",
		"https://example.com/a",
	]);
	assert_eq!(ranks, [0, 1, 2]);
}

#[test]
fn an_empty_list_has_no_ranks() {
	assert!(sort_ranks::<&str>(&[]).is_empty());
}
