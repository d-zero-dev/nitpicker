//! `compute_body_hash` fuses normalization and masking into one pass over
//! the extracted body. Its equality with the stages run one at a time rests
//! on an argument about token boundaries (see `hash_normalized_masked`);
//! this checks it on random mixes of fragments chosen to sit on those
//! boundaries: index suffixes, alphanumeric runs just under and over the
//! masking length, word bytes that are not alphanumeric (`_`), and code
//! points that fold to ASCII under Unicode case-insensitivity.

use nitpicker_html_scan::{
	compute_body_hash, extract_body, mask_dynamic_ids, normalize_url_like_strings,
};
use proptest::prelude::*;
use sha2::{Digest, Sha256};

fn staged_body_hash(html: &[u8]) -> [u8; 32] {
	let normalized = normalize_url_like_strings(extract_body(html));
	Sha256::digest(mask_dynamic_ids(&normalized).as_ref()).into()
}

const FRAGMENTS: &[&str] = &[
	"<body>",
	"<BODY class=\"a>b\">",
	"</body>",
	"/index.",
	"/INDEX.",
	"/index",
	"html",
	"php?x=1",
	"_",
	"-",
	"/",
	".",
	"a1b2c3d4",
	"a1b2c3d",
	"ABCDEFGH",
	"12345678",
	"abc",
	"123",
	"x9",
	"Z",
	"0",
	" ",
	"\u{17F}",
	"\u{212A}",
	"\u{130}",
	"日本",
];

proptest! {
	#![proptest_config(ProptestConfig::with_cases(5000))]

	#[test]
	fn equals_the_staged_pipeline(
		picks in prop::collection::vec(0..FRAGMENTS.len(), 0..32),
	) {
		let html: String = picks.iter().map(|&index| FRAGMENTS[index]).collect();
		prop_assert_eq!(
			compute_body_hash(html.as_bytes()),
			staged_body_hash(html.as_bytes()),
			"input: {:?}",
			html
		);
	}
}
