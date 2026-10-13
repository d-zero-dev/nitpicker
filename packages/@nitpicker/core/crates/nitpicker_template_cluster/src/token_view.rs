//! What Stage B needs to know about a token's text, computed once per token.
//!
//! Stage B works on token ids, but several of its steps are string
//! rewrites: class names stripped from every segment (`shape_token`),
//! anonymous wrappers dropped (`collapse_anonymous_divs`), the path above a
//! token. Each rewrite is a pure function of the token's text, so its
//! result is interned once into a table local to the merge and from then on
//! compared as an id. Two tokens rewrite to the same id exactly when the
//! rewritten strings are equal, which is the equality the stored keys were
//! computed with.
//!
//! The ids are only ever compared for equality or used as set members, never
//! ordered: they depend on the order tokens were first asked for.

use std::sync::Arc;

use rustc_hash::FxHashMap;

use crate::assign_contained_clusters::collapse_anonymous_divs;
use crate::shape_token::shape_token;
use crate::vocabulary::Vocabulary;

/// A string table numbering each distinct string once.
#[derive(Default)]
pub struct LocalStrings {
	ids: FxHashMap<String, u32>,
	strings: Vec<String>,
}

impl LocalStrings {
	/// The id of `value`, adding it on first sight.
	///
	/// # Panics
	///
	/// Past 2^32 distinct strings.
	pub fn intern(&mut self, value: &str) -> u32 {
		if let Some(&id) = self.ids.get(value) {
			return id;
		}
		let id = u32::try_from(self.strings.len()).expect("fewer than 2^32 strings");
		self.strings.push(value.to_owned());
		self.ids.insert(value.to_owned(), id);
		id
	}

	/// The string behind `id`.
	///
	/// # Panics
	///
	/// When `id` did not come from this table.
	#[must_use]
	pub fn text(&self, id: u32) -> &str {
		&self.strings[id as usize]
	}
}

/// The path above a token — everything before its last `>` — or the empty
/// string for a token without one, as `token.slice(0, Math.max(0,
/// token.lastIndexOf('>')))` reads. Class names may contain `>`, so this is
/// a string rule, not a tree walk.
#[must_use]
pub fn parent_path(token: &str) -> &str {
	token.rfind('>').map_or("", |index| &token[..index])
}

/// Token ids with their derived texts, resolved through the run's
/// vocabulary and cached.
pub struct TokenView<'v> {
	vocabulary: &'v Vocabulary,
	shapes: LocalStrings,
	shape_of_token: FxHashMap<u32, u32>,
	collapsed: LocalStrings,
	collapsed_of_token: FxHashMap<u32, u32>,
	parents: LocalStrings,
	parent_of_token: FxHashMap<u32, u32>,
}

impl<'v> TokenView<'v> {
	/// A view over `vocabulary`'s tokens.
	#[must_use]
	pub fn new(vocabulary: &'v Vocabulary) -> Self {
		Self {
			vocabulary,
			shapes: LocalStrings::default(),
			shape_of_token: FxHashMap::default(),
			collapsed: LocalStrings::default(),
			collapsed_of_token: FxHashMap::default(),
			parents: LocalStrings::default(),
			parent_of_token: FxHashMap::default(),
		}
	}

	/// The text of a token.
	#[must_use]
	pub fn text(&self, token: u32) -> Arc<str> {
		self.vocabulary.token(token)
	}

	/// The id of the token's class-stripped shape (`shape_token`).
	pub fn shape(&mut self, token: u32) -> u32 {
		if let Some(&id) = self.shape_of_token.get(&token) {
			return id;
		}
		let id = self
			.shapes
			.intern(&shape_token(&self.vocabulary.token(token)));
		self.shape_of_token.insert(token, id);
		id
	}

	/// The text behind a [`TokenView::shape`] id.
	#[must_use]
	pub fn shape_text(&self, shape: u32) -> &str {
		self.shapes.text(shape)
	}

	/// The id of the token with its interior bare wrappers dropped
	/// (`collapse_anonymous_divs`).
	pub fn collapsed(&mut self, token: u32) -> u32 {
		if let Some(&id) = self.collapsed_of_token.get(&token) {
			return id;
		}
		let id = self
			.collapsed
			.intern(&collapse_anonymous_divs(&self.vocabulary.token(token)));
		self.collapsed_of_token.insert(token, id);
		id
	}

	/// The id of the path above the token (`parent_path`).
	pub fn parent(&mut self, token: u32) -> u32 {
		if let Some(&id) = self.parent_of_token.get(&token) {
			return id;
		}
		let text = self.vocabulary.token(token);
		let id = self.parents.intern(parent_path(&text));
		self.parent_of_token.insert(token, id);
		id
	}
}

#[cfg(test)]
mod tests {
	use super::{LocalStrings, TokenView, parent_path};
	use crate::vocabulary::Vocabulary;

	#[test]
	fn numbers_equal_strings_once() {
		let mut strings = LocalStrings::default();
		let first = strings.intern("a");
		assert_eq!(strings.intern("b"), first + 1);
		assert_eq!(strings.intern("a"), first);
		assert_eq!(strings.text(first), "a");
	}

	#[test]
	fn the_parent_path_ends_before_the_last_gt() {
		assert_eq!(parent_path("body>main>.card"), "body>main");
		// No `>`: `lastIndexOf` is -1, clamped to 0.
		assert_eq!(parent_path("x1"), "");
		// A leading `>` is at index 0: an empty parent as well.
		assert_eq!(parent_path(">x"), "");
		assert_eq!(parent_path("a>b"), "a");
	}

	#[test]
	#[allow(clippy::many_single_char_names)]
	fn derived_texts_compare_by_the_rewritten_string() {
		let vocabulary = Vocabulary::default();
		let a = vocabulary.tokens.intern("body>main>section.c-a>ul.x");
		let b = vocabulary.tokens.intern("body>main>section.c-b>ul.y");
		let c = vocabulary.tokens.intern("body>div>main>.card");
		let d = vocabulary.tokens.intern("body>main>.card");
		let e = vocabulary.tokens.intern("body>main>section.c-a>p");
		let mut view = TokenView::new(&vocabulary);
		assert_eq!(view.shape(a), view.shape(b));
		let shape = view.shape(a);
		assert_eq!(view.shape_text(shape), "body>main>section>ul");
		assert_eq!(view.collapsed(c), view.collapsed(d));
		assert_ne!(view.collapsed(a), view.collapsed(d));
		assert_eq!(view.parent(a), view.parent(e));
		assert_ne!(view.parent(a), view.parent(b));
		assert_ne!(view.parent(a), view.parent(d));
	}
}
