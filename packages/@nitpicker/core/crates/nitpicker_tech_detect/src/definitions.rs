/// One fingerprint: one technology matched by one signal type through one
/// pattern, at one isolated weight. Several definitions may share a
/// technology; the confidence roll-up in `@nitpicker/archive` is what lets
/// them compound.
pub struct SignalDefinition {
	/// Normalized technology name (`Next.js`, `Vue`, ...).
	pub technology: &'static str,
	/// `html-marker`, `url-pattern`, `scoped-attr`, `weak-marker` or
	/// `js-license-comment`.
	pub signal_type: &'static str,
	/// A `regex::bytes` pattern written to match exactly what the JS
	/// regular expression it was ported from matches (see `js_space!`).
	pub pattern: &'static str,
	/// A run of bytes every match of [`Self::pattern`] contains, in lowercase
	/// ASCII. The matcher looks for all definitions' literals in one
	/// ASCII-case-insensitive Aho-Corasick pass and runs a pattern only on
	/// input that holds its literal, so a literal that some match lacks would
	/// silently drop that match — keep it to a fixed part of the pattern
	/// outside any alternation, repetition or `js_space!`
	/// (`every_required_literal_is_a_fixed_part_of_its_pattern` checks the
	/// pattern's structure, `every_match_contains_its_required_literal` the
	/// golden inputs' matches).
	pub required_literal: &'static str,
	/// This definition's confidence in isolation, 0-100.
	pub weight: u32,
	/// Category attached to the technology when only this signal fired.
	pub category: &'static str,
}

/// JS `\s` as a byte pattern over UTF-8: ASCII tab, line feed, vertical
/// tab, form feed, carriage return and space, plus U+00A0, U+1680,
/// U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF.
///
/// The definitions were JS regular expressions without the `u` flag, and
/// their stored evidence must not change, so every pattern runs with
/// Unicode mode off: `i` folds ASCII letters only and `\b` is the ASCII
/// word boundary, as in JS. Only `\s` differs, because JS's includes these
/// non-ASCII spaces; `\d` is written `[0-9]`. The `[^>]` and `[^"]` classes
/// mean the same over bytes as over UTF-16 code units, because no byte of a
/// multi-byte UTF-8 sequence is ASCII.
macro_rules! js_space {
	() => {
		r"(?:[\t\n\x0B\x0C\r ]|\xC2\xA0|\xE1\x9A\x80|\xE2\x80[\x80-\x8A\xA8\xA9\xAF]|\xE2\x81\x9F|\xE3\x80\x80|\xEF\xBB\xBF)"
	};
}

/// The fixed fingerprint list for the frontend frameworks detected through
/// structural signals (URL path fragments, HTML markers, scoped-attribute
/// conventions). A list in code, not configuration: precision is refined by
/// editing it. Every definition is matched against a page's HTML; the
/// `js-license-comment` ones are also matched against the leading bytes of
/// JS resources.
///
/// Each comment gives the JS regular expression the pattern was ported
/// from. The order is the order signals are reported in.
pub const SIGNAL_DEFINITIONS: &[SignalDefinition] = &[
	// /<script[^>]*\sid="__NEXT_DATA__"/i
	SignalDefinition {
		technology: "Next.js",
		signal_type: "html-marker",
		pattern: concat!(
			r#"(?i-u)<script[^>]*"#,
			js_space!(),
			r#"id="__NEXT_DATA__""#
		),
		required_literal: r#"id="__next_data__""#,
		weight: 70,
		category: "JavaScript frameworks",
	},
	// /<div[^>]*\sid="__next"/i
	SignalDefinition {
		technology: "Next.js",
		signal_type: "html-marker",
		pattern: concat!(r#"(?i-u)<div[^>]*"#, js_space!(), r#"id="__next""#),
		required_literal: r#"id="__next""#,
		weight: 60,
		category: "JavaScript frameworks",
	},
	// /\/_next\//
	SignalDefinition {
		technology: "Next.js",
		signal_type: "url-pattern",
		pattern: r"(?-u)/_next/",
		required_literal: r"/_next/",
		weight: 50,
		category: "JavaScript frameworks",
	},
	// /<astro-island\b/i
	SignalDefinition {
		technology: "Astro",
		signal_type: "html-marker",
		pattern: r"(?i-u)<astro-island\b",
		required_literal: r"<astro-island",
		weight: 65,
		category: "Static site generator",
	},
	// /\/_astro\//
	SignalDefinition {
		technology: "Astro",
		signal_type: "url-pattern",
		pattern: r"(?-u)/_astro/",
		required_literal: r"/_astro/",
		weight: 50,
		category: "Static site generator",
	},
	// /\sdata-astro-cid-[a-z0-9]+/i
	SignalDefinition {
		technology: "Astro",
		signal_type: "scoped-attr",
		pattern: concat!("(?i-u)", js_space!(), r"data-astro-cid-[a-z0-9]+"),
		required_literal: r"data-astro-cid-",
		weight: 40,
		category: "Static site generator",
	},
	// /\sdata-v-[a-z0-9]{6,10}\b/i
	SignalDefinition {
		technology: "Vue",
		signal_type: "scoped-attr",
		pattern: concat!("(?i-u)", js_space!(), r"data-v-[a-z0-9]{6,10}\b"),
		required_literal: r"data-v-",
		weight: 40,
		category: "JavaScript frameworks",
	},
	// /\sid="app"/i
	SignalDefinition {
		technology: "Vue",
		signal_type: "weak-marker",
		pattern: concat!("(?i-u)", js_space!(), r#"id="app""#),
		required_literal: r#"id="app""#,
		weight: 15,
		category: "JavaScript frameworks",
	},
	// /\/\*!\s*\*\s*Vue\.js v\d/i
	SignalDefinition {
		technology: "Vue",
		signal_type: "js-license-comment",
		pattern: concat!(
			r"(?i-u)/\*!",
			js_space!(),
			r"*\*",
			js_space!(),
			r"*Vue\.js v[0-9]"
		),
		required_literal: r"vue.js v",
		weight: 55,
		category: "JavaScript frameworks",
	},
	// /<div[^>]*\sid="__nuxt"/i
	SignalDefinition {
		technology: "Nuxt",
		signal_type: "html-marker",
		pattern: concat!(r#"(?i-u)<div[^>]*"#, js_space!(), r#"id="__nuxt""#),
		required_literal: r#"id="__nuxt""#,
		weight: 60,
		category: "JavaScript frameworks",
	},
	// /\/_nuxt\//
	SignalDefinition {
		technology: "Nuxt",
		signal_type: "url-pattern",
		pattern: r"(?-u)/_nuxt/",
		required_literal: r"/_nuxt/",
		weight: 50,
		category: "JavaScript frameworks",
	},
	// /class="[^"]*\bsvelte-[a-z0-9]{6,8}\b/i
	SignalDefinition {
		technology: "Svelte",
		signal_type: "scoped-attr",
		pattern: r#"(?i-u)class="[^"]*\bsvelte-[a-z0-9]{6,8}\b"#,
		required_literal: r"svelte-",
		weight: 40,
		category: "JavaScript frameworks",
	},
	// /\/_app\/immutable\//
	SignalDefinition {
		technology: "SvelteKit",
		signal_type: "url-pattern",
		pattern: r"(?-u)/_app/immutable/",
		required_literal: r"/_app/immutable/",
		weight: 50,
		category: "JavaScript frameworks",
	},
	// /window\.__remixContext\s*=/i
	SignalDefinition {
		technology: "Remix",
		signal_type: "html-marker",
		pattern: concat!(r"(?i-u)window\.__remixContext", js_space!(), "*="),
		required_literal: r"window.__remixcontext",
		weight: 65,
		category: "JavaScript frameworks",
	},
	// /<div[^>]*\sid="___gatsby"/i
	SignalDefinition {
		technology: "Gatsby",
		signal_type: "html-marker",
		pattern: concat!(r#"(?i-u)<div[^>]*"#, js_space!(), r#"id="___gatsby""#),
		required_literal: r#"id="___gatsby""#,
		weight: 65,
		category: "Static site generator",
	},
	// /\/page-data\//
	SignalDefinition {
		technology: "Gatsby",
		signal_type: "url-pattern",
		pattern: r"(?-u)/page-data/",
		required_literal: r"/page-data/",
		weight: 50,
		category: "Static site generator",
	},
	// /\sng-version="[\d.]+"/i
	SignalDefinition {
		technology: "Angular",
		signal_type: "html-marker",
		pattern: concat!("(?i-u)", js_space!(), r#"ng-version="[0-9.]+""#),
		required_literal: r#"ng-version=""#,
		weight: 65,
		category: "JavaScript frameworks",
	},
	// /\s_ngcontent-[a-z0-9-]+/i
	SignalDefinition {
		technology: "Angular",
		signal_type: "scoped-attr",
		pattern: concat!("(?i-u)", js_space!(), r"_ngcontent-[a-z0-9-]+"),
		required_literal: r"_ngcontent-",
		weight: 40,
		category: "JavaScript frameworks",
	},
];

#[cfg(test)]
mod tests {
	use super::SIGNAL_DEFINITIONS;

	/// The runs of literal characters a pattern requires at its top level:
	/// text outside groups and classes, broken at every escape that is not a
	/// literal character, at `.`, `^`, `$`, and around quantifiers (a
	/// character a `*`, `?` or `{0,…}` makes optional is dropped). Returns
	/// nothing for a pattern with a top-level alternation, where no run is
	/// required.
	fn required_runs(pattern: &str) -> Vec<String> {
		let chars: Vec<char> = pattern.chars().collect();
		let mut runs = Vec::new();
		let mut run = String::new();
		let mut index = 0;
		while index < chars.len() {
			let character = chars[index];
			index += 1;
			match character {
				'(' | '[' => {
					runs.push(std::mem::take(&mut run));
					index = skip_bracketed(&chars, index, character);
				}
				'\\' => {
					let escaped = chars[index];
					index += 1;
					if r".*/+?()[]{}|^$\-".contains(escaped) {
						run.push(escaped);
					} else {
						runs.push(std::mem::take(&mut run));
					}
				}
				'*' | '?' => {
					run.pop();
					runs.push(std::mem::take(&mut run));
				}
				'+' | '.' | '^' | '$' => runs.push(std::mem::take(&mut run)),
				'{' => {
					if chars[index] == '0' {
						run.pop();
					}
					runs.push(std::mem::take(&mut run));
					while chars[index] != '}' {
						index += 1;
					}
					index += 1;
				}
				'|' => return Vec::new(),
				_ => run.push(character),
			}
		}
		runs.push(run);
		runs
	}

	/// Returns the index just past the `)` or `]` that closes the group or
	/// class opened before `index`, skipping escapes and nested brackets.
	fn skip_bracketed(chars: &[char], mut index: usize, open: char) -> usize {
		let mut depth = 1;
		while depth > 0 {
			match chars[index] {
				'\\' => index += 1,
				'[' if open == '(' => index = skip_bracketed(chars, index + 1, '[') - 1,
				'(' if open == '(' => depth += 1,
				')' if open == '(' => depth -= 1,
				']' if open == '[' => depth -= 1,
				_ => {}
			}
			index += 1;
		}
		index
	}

	#[test]
	fn every_required_literal_is_a_fixed_part_of_its_pattern() {
		for definition in SIGNAL_DEFINITIONS {
			let literal = definition.required_literal;
			assert!(!literal.is_empty(), "{}: empty literal", definition.pattern);
			assert_eq!(
				literal,
				literal.to_ascii_lowercase(),
				"{literal}: not lowercase ASCII"
			);
			assert!(
				required_runs(definition.pattern)
					.iter()
					.any(|run| run.to_ascii_lowercase().contains(literal)),
				"{literal} is not a fixed run of {}",
				definition.pattern
			);
		}
	}

	#[test]
	fn finds_no_required_run_inside_optional_or_alternative_parts() {
		assert_eq!(required_runs("(?i)ab(cd)ef"), ["", "ab", "ef"]);
		assert!(!required_runs("abc?d").iter().any(|run| run.contains("abc")));
		assert!(
			!required_runs("ab{0,2}c")
				.iter()
				.any(|run| run.contains("ab"))
		);
		assert!(required_runs("ab|cd").is_empty());
		assert_eq!(required_runs(r"a\.b\sc[x]d"), ["a.b", "c", "d"]);
	}
}
