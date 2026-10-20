use regex::{Regex, RegexBuilder};

/// The flags of a regular-expression search pattern.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RegexFlags {
	/// `i`.
	pub ignore_case: bool,
	/// `m`: `^` and `$` match at every line break (`\n`).
	pub multi_line: bool,
	/// `s`: `.` matches a line break too.
	pub dot_matches_new_line: bool,
}

/// What a search pattern's text means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchKind {
	/// Plain text; there are no flags.
	Literal,
	/// A regular expression with its flags.
	Regex(RegexFlags),
}

/// How `query search-html` reads its `--pattern`: a literal substring or a
/// regular expression, and the flags that apply to a regular expression.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchPattern {
	/// The text, or the regular expression's source.
	pub source: String,
	/// How `source` is read.
	pub kind: SearchKind,
}

/// A search pattern is not a regular expression this matcher can run.
#[derive(Debug, PartialEq, Eq)]
pub struct SearchPatternError {
	/// What the regex engine reported.
	pub reason: String,
}

impl std::fmt::Display for SearchPatternError {
	fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		formatter.write_str(&self.reason)
	}
}

impl std::error::Error for SearchPatternError {}

/// Compiles a search pattern in Unicode mode: the match unit is a Unicode
/// scalar value, and `\d` `\w` `\s` `\b` use Unicode's definitions.
///
/// Unlike the patterns behind persisted values (`(?-u)` there, so they stay
/// byte-identical to what JavaScript stored), nothing here is persisted: the
/// contract in `docs/query.md` is the answer. Backreferences and look-around
/// are rejected by the engine, which also guarantees matching in time linear
/// in the document.
///
/// # Errors
///
/// A syntax error, an unsupported construct, or a pattern that compiles to
/// more than the engine's size limit.
pub fn compile_search_pattern(pattern: &SearchPattern) -> Result<Regex, SearchPatternError> {
	let (source, flags) = match pattern.kind {
		SearchKind::Literal => (regex::escape(&pattern.source), RegexFlags::default()),
		SearchKind::Regex(flags) => (pattern.source.clone(), flags),
	};
	let mut builder = RegexBuilder::new(&source);
	// CRLF mode: `\r` and `\n` both end a line (`\r\n` as one), so `^` and `$`
	// under `m` work on CRLF text and `.` stops at both, as JavaScript's does.
	builder
		.crlf(true)
		.case_insensitive(flags.ignore_case)
		.multi_line(flags.multi_line)
		.dot_matches_new_line(flags.dot_matches_new_line);
	builder.build().map_err(|error| SearchPatternError {
		reason: error.to_string(),
	})
}

#[cfg(test)]
mod tests {
	use super::{RegexFlags, SearchKind, SearchPattern, compile_search_pattern};

	fn regex(source: &str, flags: RegexFlags) -> SearchPattern {
		SearchPattern {
			source: source.to_owned(),
			kind: SearchKind::Regex(flags),
		}
	}

	fn plain(source: &str) -> SearchPattern {
		regex(source, RegexFlags::default())
	}

	#[test]
	fn a_literal_is_escaped() {
		let compiled = compile_search_pattern(&SearchPattern {
			source: "He.lo".to_owned(),
			kind: SearchKind::Literal,
		})
		.unwrap();
		assert!(compiled.is_match("He.lo"));
		assert!(!compiled.is_match("Hello"));
	}

	#[test]
	fn applies_the_flags() {
		assert!(
			!compile_search_pattern(&plain("^a.b$"))
				.unwrap()
				.is_match("A\nB")
		);
		let compiled = compile_search_pattern(&regex(
			"^a.b$",
			RegexFlags {
				ignore_case: true,
				multi_line: true,
				dot_matches_new_line: true,
			},
		))
		.unwrap();
		assert!(compiled.is_match("x\nA\nB\ny"));
		assert!(compiled.is_match("x\nA-B\ny"));
		assert!(compiled.is_match("A\nB"));
	}

	#[test]
	fn a_dot_stops_at_a_carriage_return_and_a_line_feed_but_not_at_other_separators() {
		let compiled = compile_search_pattern(&plain("a.b")).unwrap();
		assert!(compiled.is_match("a\u{2028}b"));
		assert!(!compiled.is_match("a\rb"));
		assert!(!compiled.is_match("a\nb"));
	}

	#[test]
	fn the_line_anchors_of_the_m_flag_see_crlf_and_cr_and_lf() {
		let multi_line = RegexFlags {
			multi_line: true,
			..RegexFlags::default()
		};
		let end = compile_search_pattern(&regex("foo$", multi_line)).unwrap();
		assert!(end.is_match("foo\r\nbar"));
		assert!(end.is_match("foo\rbar"));
		assert!(end.is_match("foo\nbar"));
		assert!(!end.is_match("foobar"));
		let start = compile_search_pattern(&regex("^bar", multi_line)).unwrap();
		assert!(start.is_match("foo\r\nbar"));
		assert!(start.is_match("foo\rbar"));
	}

	#[test]
	fn rejects_backreferences_and_look_around() {
		for source in [r"(a)\1", "(?=a)b", "(?<=a)b", "(?!a)b", "(?<!a)b"] {
			assert!(compile_search_pattern(&plain(source)).is_err(), "{source}");
		}
	}

	#[test]
	fn rejects_a_syntax_error_with_the_engine_message() {
		let error = compile_search_pattern(&plain("(")).unwrap_err();
		assert!(error.to_string().contains("unclosed group"), "{error}");
	}

	#[test]
	fn rejects_a_pattern_over_the_size_limit() {
		assert!(compile_search_pattern(&plain(r"\w{1000}{1000}")).is_err());
	}
}
