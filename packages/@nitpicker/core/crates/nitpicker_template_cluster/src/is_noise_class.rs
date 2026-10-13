//! Auto-generated class names that change per build while the template does
//! not (CSS Modules, styled-components, emotion, bundler content hashes).
//!
//! Each check below is one of the JavaScript regular expressions the stored
//! keys were computed with, written out by hand because the `regex` crate has no
//! look-ahead. Every character class in them is ASCII, and without the `u`
//! flag JavaScript's case-insensitive matching never folds a non-ASCII
//! character into ASCII, so a byte-level ASCII check is exact.

fn is_alnum(byte: u8) -> bool {
	byte.is_ascii_alphanumeric()
}

/// `/^_[a-z0-9]{5,}$/i` — a bare CSS Modules hash suffix (`_a1b2c3`).
fn is_css_modules_hash(name: &[u8]) -> bool {
	matches!(name, [b'_', rest @ ..] if rest.len() >= 5 && rest.iter().copied().all(is_alnum))
}

/// `/^sc-(?=[a-zA-Z0-9]*[A-Z\d])[a-zA-Z0-9]{5,}$/` — styled-components
/// (`sc-bdVaJa`), which always carries an upper-case letter or a digit,
/// unlike author-written `sc-header`.
fn is_styled_components_hash(name: &[u8]) -> bool {
	let Some(rest) = name.strip_prefix(b"sc-") else {
		return false;
	};
	rest.len() >= 5
		&& rest.iter().copied().all(is_alnum)
		&& rest
			.iter()
			.any(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

/// `/^css-(?=[a-z0-9]*\d)[a-z0-9]{5,8}$/i` — emotion (`css-1x2y3z`).
fn is_emotion_hash(name: &[u8]) -> bool {
	if name.len() < 4 || !name[..4].eq_ignore_ascii_case(b"css-") {
		return false;
	}
	let rest = &name[4..];
	(5..=8).contains(&rest.len())
		&& rest.iter().copied().all(is_alnum)
		&& rest.iter().any(u8::is_ascii_digit)
}

/// `/^[a-z]+-(?=[a-f0-9]*\d)[a-f0-9]{6,8}$/i` — a bundler content-hash suffix
/// (`chunk-a3f9c1`). The letters stop at the first non-letter, which must
/// be the `-`.
fn is_bundler_hash_suffix(name: &[u8]) -> bool {
	let letters = name
		.iter()
		.take_while(|byte| byte.is_ascii_alphabetic())
		.count();
	if letters == 0 || name.get(letters) != Some(&b'-') {
		return false;
	}
	let rest = &name[letters + 1..];
	(6..=8).contains(&rest.len())
		&& rest.iter().all(u8::is_ascii_hexdigit)
		&& rest.iter().any(u8::is_ascii_digit)
}

/// `/^(?=.*[a-z])(?=.*\d)[a-z0-9]{6,10}$/` — a generic lower-case hash
/// (`k3j9zq2a`) mixing letters and digits.
fn is_generic_hash(name: &[u8]) -> bool {
	(6..=10).contains(&name.len())
		&& name
			.iter()
			.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
		&& name.iter().any(u8::is_ascii_lowercase)
		&& name.iter().any(u8::is_ascii_digit)
}

/// `/__(?=[a-z0-9]{5,8}$)(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{5,8}$/i` —
/// webpack CSS Modules' `[name]_[local]__[hash]` (`Layout_root__f3k9d`),
/// matched anywhere in the name.
fn is_webpack_css_modules_hash(name: &[u8]) -> bool {
	(0..name.len().saturating_sub(1)).any(|start| {
		if name[start] != b'_' || name[start + 1] != b'_' {
			return false;
		}
		let rest = &name[start + 2..];
		(5..=8).contains(&rest.len())
			&& rest.iter().copied().all(is_alnum)
			&& rest.iter().any(u8::is_ascii_alphabetic)
			&& rest.iter().any(u8::is_ascii_digit)
	})
}

/// Whether `name` matches any of the built-in auto-generated-class patterns.
#[must_use]
pub fn is_noise_class(name: &str) -> bool {
	let name = name.as_bytes();
	is_css_modules_hash(name)
		|| is_styled_components_hash(name)
		|| is_emotion_hash(name)
		|| is_bundler_hash_suffix(name)
		|| is_generic_hash(name)
		|| is_webpack_css_modules_hash(name)
}

#[cfg(test)]
mod tests {
	use super::is_noise_class;

	#[test]
	fn catches_each_generator_pattern() {
		for name in [
			"_a1b2c3",
			"sc-bdVaJa",
			"CSS-1x2y3z",
			"chunk-a3f9c1",
			"k3j9zq2a",
			"Layout_root__f3k9d",
			"Header_title__3xJ9k",
		] {
			assert!(is_noise_class(name), "{name}");
		}
	}

	#[test]
	fn keeps_author_written_names() {
		for name in [
			"card--active",
			"sc-header",
			"css-editor",
			"section-facade",
			"Section1",
			"et_pb_gutters3",
			"col2",
			"abcdef",
			"123456",
			"__col",
			"\u{17F}c-abcde",
		] {
			assert!(!is_noise_class(name), "{name}");
		}
	}

	#[test]
	fn classifies_every_documented_class_name() {
		let cases = [
			("_a1b2c3", true),
			("sc-bdVaJa", true),
			("css-1x2y3z", true),
			("chunk-a3f9c1", true),
			("k3j9zq2a", true),
			("card", false),
			("card--active", false),
			("footer", false),
			("current", false),
			// CamelCase words ending in a digit are not generic hashes.
			("Section1", false),
			("Banner99", false),
			// BEM names survive.
			("card__title--large", false),
			("nav__list-item--is-current", false),
			// Bundler content-hash suffix.
			("s-1a2b3c4d", true),
			// Tailwind arbitrary values.
			("w-[137px]", false),
			// webpack CSS Modules.
			("Layout_root__f3k9d", true),
			("Header_title__3xJ9k", true),
			// A single-underscore hash suffix is a known, accepted gap.
			("hsForm_9f8e7d6c", false),
			// Short names after `__` fall below the 5-character floor.
			("menu__list", false),
			("grid__col2", false),
			// Single-underscore variant suffixes are not hashes.
			("et_pb_gutters3", false),
			("grid_col12", false),
			("row_span24", false),
			("tab_index1a", false),
			("avatar_size32", false),
			// Real words that fit a hash pattern's character set.
			("sc-header", false),
			("sc-active", false),
			("sc-container", false),
			("css-editor", false),
			("css-toolbar", false),
			("section-facade", false),
			("section-decade", false),
			// A styled-components hash longer than 10 characters.
			("sc-aB3xQ9zR7kM2", true),
		];
		for (name, expected) in cases {
			assert_eq!(is_noise_class(name), expected, "{name}");
		}
	}
}
