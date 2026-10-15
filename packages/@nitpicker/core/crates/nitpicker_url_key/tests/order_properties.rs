//! Properties of the order over random URLs. The comparison is on bytes (the
//! key, then the raw string), so transitivity and antisymmetry hold by
//! construction; what can fail is its meaning — that it does not depend on
//! input order, that URLs with equal keys fall back to their raw strings, and
//! that its rules (host before path, numbers by value, ...) hold for URLs the
//! examples never thought of.

use nitpicker_url_key::{build_url_sort_key, sort_ranks};
use proptest::prelude::*;

/// A path segment drawn from names that exercise the rules: numbers with and
/// without leading zeros, index pages, mixed case, escapes and plain words.
fn segment() -> impl Strategy<Value = String> {
	prop_oneof![
		"[a-zA-Z]{1,4}",
		"[a-z]{0,2}[0-9]{1,3}[a-z]{0,2}",
		Just("index.html".to_owned()),
		Just("Index.php".to_owned()),
		Just("index2.html".to_owned()),
		Just("%E3%81%82".to_owned()),
		Just("a%2Fb".to_owned()),
		Just("v1.10".to_owned()),
	]
}

/// An HTTP(S) URL with a small host set (so hosts collide) and a random path,
/// query and fragment.
fn http_url() -> impl Strategy<Value = String> {
	(
		prop_oneof![Just("http"), Just("https")],
		prop_oneof![
			Just("a.example.com"),
			Just("b.example.com"),
			Just("A.example.com:8080")
		],
		prop::collection::vec(segment(), 0..4),
		any::<bool>(),
		prop::option::of("[a-c]=[0-9]{1,2}(&[a-c]=[0-9]{1,2}){0,2}"),
		prop::option::of("[a-z]{1,3}"),
	)
		.prop_map(
			|(scheme, host, segments, trailing_slash, query, fragment)| {
				let mut url = format!("{scheme}://{host}/{}", segments.join("/"));
				if trailing_slash && !segments.is_empty() {
					url.push('/');
				}
				if let Some(query) = query {
					url.push('?');
					url.push_str(&query);
				}
				if let Some(fragment) = fragment {
					url.push('#');
					url.push_str(&fragment);
				}
				url
			},
		)
}

/// Any URL-ish string, including ones that do not parse.
fn any_url() -> impl Strategy<Value = String> {
	prop_oneof![
		8 => http_url(),
		1 => Just("mailto:someone@example.com".to_owned()),
		1 => "\\PC{0,12}",
	]
}

/// The URLs in sorted order, by the ranks.
fn sorted<'a>(urls: &[&'a str]) -> Vec<&'a str> {
	let ranks = sort_ranks(urls);
	let mut out = vec![""; urls.len()];
	for (position, rank) in ranks.iter().enumerate() {
		out[*rank as usize] = urls[position];
	}
	out
}

proptest! {
	#[test]
	fn ranks_are_a_permutation(urls in prop::collection::vec(any_url(), 0..40)) {
		let ranks = sort_ranks(&urls);
		let mut seen = ranks.clone();
		seen.sort_unstable();
		let expected: Vec<u32> = (0..u32::try_from(urls.len()).unwrap()).collect();
		prop_assert_eq!(seen, expected);
	}

	#[test]
	fn the_sorted_order_does_not_depend_on_the_input_order(
		urls in prop::collection::vec(any_url(), 0..40),
		shift in 0_usize..40,
	) {
		let borrowed: Vec<&str> = urls.iter().map(String::as_str).collect();
		let mut rotated = borrowed.clone();
		rotated.rotate_left(shift % borrowed.len().max(1));
		rotated.reverse();
		prop_assert_eq!(sorted(&borrowed), sorted(&rotated));
	}

	#[test]
	fn sorting_twice_changes_nothing(urls in prop::collection::vec(any_url(), 0..40)) {
		let borrowed: Vec<&str> = urls.iter().map(String::as_str).collect();
		let once = sorted(&borrowed);
		let twice = sorted(&once);
		prop_assert_eq!(once, twice);
	}

	#[test]
	fn urls_with_equal_keys_order_by_their_raw_strings(
		path in prop::collection::vec(segment(), 0..3),
		port_a in prop::option::of(1_u16..9999),
		port_b in prop::option::of(1_u16..9999),
	) {
		// The same URL written with different ports: the key leaves the port
		// out, so the raw strings decide.
		let with_port = |port: Option<u16>| match port {
			Some(port) => format!("https://a.example.com:{port}/{}", path.join("/")),
			None => format!("https://a.example.com/{}", path.join("/")),
		};
		let (a, b) = (with_port(port_a), with_port(port_b));
		prop_assert_eq!(build_url_sort_key(&a), build_url_sort_key(&b));
		prop_assume!(a != b);
		let ranks = sort_ranks(&[a.clone(), b.clone()]);
		prop_assert_eq!(ranks[0] < ranks[1], a < b);
	}

	#[test]
	fn the_ranks_follow_the_keys_then_the_raw_strings(
		urls in prop::collection::vec(any_url(), 0..40),
	) {
		let borrowed: Vec<&str> = urls.iter().map(String::as_str).collect();
		let ordered = sorted(&borrowed);
		for pair in ordered.windows(2) {
			let (first, second) = (build_url_sort_key(pair[0]), build_url_sort_key(pair[1]));
			prop_assert!(first < second || (first == second && pair[0] <= pair[1]));
		}
	}

	#[test]
	fn a_number_in_a_path_segment_compares_by_value(
		prefix in "[a-z]{0,3}",
		a in 0_u32..100_000,
		b in 0_u32..100_000,
	) {
		prop_assume!(a != b);
		let first = format!("https://example.com/{prefix}{a}");
		let second = format!("https://example.com/{prefix}{b}");
		let ranks = sort_ranks(&[first, second]);
		prop_assert_eq!(ranks[0] < ranks[1], a < b);
	}

	#[test]
	fn the_host_decides_before_the_path(path_a in segment(), path_b in segment()) {
		let ranks = sort_ranks(&[
			format!("https://b.example.com/{path_a}"),
			format!("https://a.example.com/{path_b}"),
		]);
		prop_assert_eq!(ranks, vec![1, 0]);
	}

	#[test]
	fn letter_case_in_a_path_does_not_move_a_url_among_others(
		word in "[a-z]{1,6}",
		other in "[a-z]{1,6}",
	) {
		prop_assume!(word != other);
		let lower = sort_ranks(&[
			format!("https://example.com/{word}"),
			format!("https://example.com/{other}"),
		]);
		let upper = sort_ranks(&[
			format!("https://example.com/{}", word.to_uppercase()),
			format!("https://example.com/{other}"),
		]);
		prop_assert_eq!(lower, upper);
	}
}
