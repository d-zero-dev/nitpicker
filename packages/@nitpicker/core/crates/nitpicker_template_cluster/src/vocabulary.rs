use std::sync::Arc;

use crate::interner::{Interner, ScratchIds, SharedCache, is_scratch_id};

/// The interned strings of one classification run: class names, path
/// segments (`ul`, `.card`, `svg[sha=…]`) and tokens (root-to-leaf paths,
/// `body>main>.card>p`).
///
/// A token is identified by its full path string, never by how it was
/// built: a class name may itself contain `>`, so `body` + `.a>b` and
/// `body>.a` + `b` are one token, exactly as the equal strings are one
/// member of a JavaScript `Set`. The `(parent, segment)` cache only skips
/// rebuilding a path string already seen.
#[derive(Default)]
pub struct Vocabulary {
	pub(crate) classes: Interner,
	pub(crate) segments: Interner,
	pub(crate) tokens: Interner,
	children: SharedCache<(u32, u32), u32>,
}

/// No parent: the token is the segment alone (the `<body>` root).
const ROOT: u32 = u32::MAX;

impl Vocabulary {
	/// The text of a token id.
	#[must_use]
	pub fn token(&self, id: u32) -> Arc<str> {
		self.tokens.resolve(id)
	}
}

/// How ids are handed out while tokenizing a page: [`Ids::Shared`] interns
/// everything (pages whose tokens are kept), [`Ids::Scratch`] only looks the
/// shared tables up and numbers anything new locally (pages compared once
/// and dropped, which would otherwise grow the tables with every page's
/// unique content hashes).
pub enum Ids<'a> {
	/// Intern into the shared tables.
	Shared(&'a Vocabulary),
	/// Read the shared tables, number the rest locally.
	Scratch(&'a Vocabulary, &'a mut ScratchVocabulary),
}

/// The local numbering behind [`Ids::Scratch`].
#[derive(Default)]
pub struct ScratchVocabulary {
	classes: ScratchIds,
	segments: ScratchIds,
	tokens: ScratchIds,
}

impl Ids<'_> {
	fn vocabulary(&self) -> &Vocabulary {
		match self {
			Ids::Shared(vocabulary) | Ids::Scratch(vocabulary, _) => vocabulary,
		}
	}

	/// The id of a class name.
	pub fn class(&mut self, name: &str) -> u32 {
		match self {
			Ids::Shared(vocabulary) => vocabulary.classes.intern(name),
			Ids::Scratch(vocabulary, local) => {
				local.classes.get_or_assign(&vocabulary.classes, name)
			}
		}
	}

	/// The id of a path segment.
	pub fn segment(&mut self, segment: &str) -> u32 {
		match self {
			Ids::Shared(vocabulary) => vocabulary.segments.intern(segment),
			Ids::Scratch(vocabulary, local) => {
				local.segments.get_or_assign(&vocabulary.segments, segment)
			}
		}
	}

	fn segment_text(&self, id: u32) -> Arc<str> {
		match self {
			Ids::Scratch(_, local) if is_scratch_id(id) => local
				.segments
				.resolve(id)
				.expect("a scratch id resolves in its own table")
				.into(),
			_ => self.vocabulary().segments.resolve(id),
		}
	}

	fn token_text(&self, id: u32) -> Arc<str> {
		match self {
			Ids::Scratch(_, local) if is_scratch_id(id) => local
				.tokens
				.resolve(id)
				.expect("a scratch id resolves in its own table")
				.into(),
			_ => self.vocabulary().tokens.resolve(id),
		}
	}

	/// The token `parent>segment` (or `segment` alone without a parent).
	pub fn child_token(&mut self, parent: Option<u32>, segment: u32) -> u32 {
		let key = (parent.unwrap_or(ROOT), segment);
		let cacheable = !is_scratch_id(segment) && parent.is_none_or(|id| !is_scratch_id(id));
		if cacheable && let Some(id) = self.vocabulary().children.get(&key) {
			return id;
		}
		let segment_text = self.segment_text(segment);
		let text = match parent {
			Some(parent) => format!("{}>{segment_text}", self.token_text(parent)),
			None => segment_text.to_string(),
		};
		match self {
			Ids::Shared(vocabulary) => {
				let id = vocabulary.tokens.intern(&text);
				vocabulary.children.insert(key, id);
				id
			}
			Ids::Scratch(vocabulary, local) => {
				let id = local.tokens.get_or_assign(&vocabulary.tokens, &text);
				if cacheable && !is_scratch_id(id) {
					vocabulary.children.insert(key, id);
				}
				id
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::{Ids, ScratchVocabulary, Vocabulary};
	use crate::interner::is_scratch_id;

	#[test]
	fn builds_paths_and_unifies_equal_strings_built_differently() {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		let body = ids.segment("body");
		let root = ids.child_token(None, body);
		let class_with_gt = ids.segment(".a>b");
		let one = ids.child_token(Some(root), class_with_gt);
		let dot_a = ids.segment(".a");
		let b = ids.segment("b");
		let parent = ids.child_token(Some(root), dot_a);
		let two = ids.child_token(Some(parent), b);
		assert_eq!(one, two);
		assert_eq!(&*vocabulary.token(one), "body>.a>b");
	}

	#[test]
	fn numbers_new_paths_locally_in_scratch_mode() {
		let vocabulary = Vocabulary::default();
		let (root, known) = {
			let mut ids = Ids::Shared(&vocabulary);
			let body = ids.segment("body");
			let root = ids.child_token(None, body);
			let main = ids.segment("main");
			(root, ids.child_token(Some(root), main))
		};
		let mut local = ScratchVocabulary::default();
		let mut ids = Ids::Scratch(&vocabulary, &mut local);
		let main = ids.segment("main");
		assert_eq!(ids.child_token(Some(root), main), known);
		let unknown = ids.segment("aside");
		let token = ids.child_token(Some(root), unknown);
		assert!(is_scratch_id(token));
		let deeper = ids.segment("p");
		let nested = ids.child_token(Some(token), deeper);
		assert!(is_scratch_id(nested));
		assert_eq!(vocabulary.tokens.get("body>aside"), None);
	}
}
