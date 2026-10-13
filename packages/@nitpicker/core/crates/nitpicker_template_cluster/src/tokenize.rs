//! The structural tokens of a page's `<body>`: one root-to-leaf path per
//! leaf element, e.g. `body>main>.card>p`.
//!
//! A replay of the `onopentag` / `onclosetag` events of
//! `nitpicker_html_parser`. Text is discarded; `script` / `style` /
//! `noscript` / `svg` are leaves named by a hash of their content; a bare
//! `div` / `span` with exactly one element child folds out of the path (its
//! nesting carries no structure); `<body>`'s own classes are left out
//! because CMSs put per-page labels there that would otherwise prefix — and
//! so differentiate — every path. Only the first `<body>` counts; a stray
//! `<body>` tag inside it is ignored like a browser ignores it.

use nitpicker_html_parser::{Document, Event, EventKind, TagName, parse};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::hash_content::hash_content;
use crate::parse_class_list::parse_class_list;
use crate::segment::{build_opaque_segment, build_segment, is_fold_candidate};
use crate::vocabulary::Ids;

const NONE: u32 = u32::MAX;

fn is_opaque(name: TagName) -> bool {
	matches!(
		name,
		TagName::SCRIPT | TagName::STYLE | TagName::NOSCRIPT | TagName::SVG
	)
}

/// The tokens and class names of one page.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tokenized {
	/// Distinct tokens in document order of their first leaf.
	pub tokens: Vec<u32>,
	/// Distinct class names on elements below `<body>` (after filtering), in
	/// first-seen order.
	pub classes: Vec<u32>,
}

/// One opening tag's segment ingredients, worked out once per document and
/// reused by every replay of it.
struct ElementInfo {
	classes: Vec<(u32, Box<str>)>,
	role: Option<Box<str>>,
	r#type: Option<Box<str>>,
	segment: u32,
	fold_candidate: bool,
}

/// Per-document memo for repeated replays of one [`Document`] (the depth
/// sweep replays it once per candidate depth).
#[derive(Default)]
pub struct ReplayCache {
	elements: FxHashMap<u32, ElementInfo>,
	class_lists: FxHashMap<Box<str>, Vec<(u32, Box<str>)>>,
	hashes: FxHashMap<(usize, usize), u32>,
}

fn non_empty(value: Option<&str>) -> Option<Box<str>> {
	value.filter(|value| !value.is_empty()).map(Into::into)
}

impl ReplayCache {
	fn element(
		&mut self,
		html: &str,
		document: &Document,
		index: u32,
		ids: &mut Ids,
	) -> &ElementInfo {
		if !self.elements.contains_key(&index) {
			let event = &document.events[index as usize];
			let attributes = document.attributes_of(event);
			let class_attribute = attributes
				.class
				.as_ref()
				.map_or("", |value| value.decoded(html));
			let classes = if let Some(classes) = self.class_lists.get(class_attribute) {
				classes.clone()
			} else {
				let classes: Vec<(u32, Box<str>)> = parse_class_list(class_attribute)
					.into_iter()
					.map(|name| (ids.class(name), name.into()))
					.collect();
				self.class_lists
					.insert(class_attribute.into(), classes.clone());
				classes
			};
			let role = non_empty(attributes.role.as_ref().map(|value| value.decoded(html)));
			let r#type = non_empty(attributes.r#type.as_ref().map(|value| value.decoded(html)));
			let tag = document.tag_name(event.name);
			let names: Vec<&str> = classes.iter().map(|(_, name)| &**name).collect();
			let segment = ids.segment(&build_segment(
				tag,
				&names,
				role.as_deref(),
				r#type.as_deref(),
			));
			let fold_candidate = is_fold_candidate(tag, &names, role.as_deref(), r#type.as_deref());
			self.elements.insert(
				index,
				ElementInfo {
					classes,
					role,
					r#type,
					segment,
					fold_candidate,
				},
			);
		}
		&self.elements[&index]
	}
}

struct Node {
	segment: u32,
	fold_candidate: bool,
	child_elements: u32,
	first_child: u32,
	last_child: u32,
}

#[derive(Clone, Copy)]
enum ChildKind {
	Element(u32),
	Leaf(u32),
}

struct Child {
	kind: ChildKind,
	next: u32,
}

#[derive(Default)]
struct Tree {
	nodes: Vec<Node>,
	children: Vec<Child>,
}

impl Tree {
	fn add_node(&mut self, segment: u32, fold_candidate: bool) -> u32 {
		self.nodes.push(Node {
			segment,
			fold_candidate,
			child_elements: 0,
			first_child: NONE,
			last_child: NONE,
		});
		u32::try_from(self.nodes.len() - 1).expect("fewer than 2^32 elements")
	}

	fn append(&mut self, parent: u32, kind: ChildKind) {
		let child = u32::try_from(self.children.len()).expect("fewer than 2^32 children");
		self.children.push(Child { kind, next: NONE });
		let node = &mut self.nodes[parent as usize];
		if node.last_child == NONE {
			node.first_child = child;
		} else {
			self.children[node.last_child as usize].next = child;
		}
		self.nodes[parent as usize].last_child = child;
	}

	/// The tokens below `root`, prefixing each leaf with every ancestor
	/// segment that did not fold away.
	fn emit(&self, root: u32, ids: &mut Ids) -> Vec<u32> {
		let mut tokens = Vec::new();
		let mut seen = FxHashSet::default();
		let mut push = |token: u32, tokens: &mut Vec<u32>| {
			if seen.insert(token) {
				tokens.push(token);
			}
		};
		let mut stack: Vec<(ChildKind, Option<u32>)> = vec![(ChildKind::Element(root), None)];
		let mut children = Vec::new();
		while let Some((kind, prefix)) = stack.pop() {
			match kind {
				ChildKind::Leaf(segment) => push(ids.child_token(prefix, segment), &mut tokens),
				ChildKind::Element(node) => {
					let node = &self.nodes[node as usize];
					if node.first_child == NONE {
						push(ids.child_token(prefix, node.segment), &mut tokens);
						continue;
					}
					let child_prefix = if node.fold_candidate && node.child_elements == 1 {
						prefix
					} else {
						Some(ids.child_token(prefix, node.segment))
					};
					children.clear();
					let mut child = node.first_child;
					while child != NONE {
						children.push(self.children[child as usize].kind);
						child = self.children[child as usize].next;
					}
					stack.extend(children.iter().rev().map(|&kind| (kind, child_prefix)));
				}
			}
		}
		tokens
	}
}

struct Opaque {
	name: TagName,
	depth: u32,
	content_start: usize,
	role: Option<Box<str>>,
	r#type: Option<Box<str>>,
}

/// The state of one replay: an htmlparser2 handler over the recorded
/// events, building a tree instead of path strings (a wrapper's folding
/// is only known once it closes, so paths are built top-down at the end).
struct Replay<'a, 'b, 'c> {
	html: &'a str,
	document: &'a Document,
	allowed: Option<&'a FxHashSet<u32>>,
	cache: &'b mut ReplayCache,
	ids: &'b mut Ids<'c>,
	tree: Tree,
	stack: Vec<u32>,
	opaque: Option<Opaque>,
	body_done: bool,
	ignored_body_opens: u32,
	root: u32,
	classes: Vec<u32>,
	seen_classes: FxHashSet<u32>,
}

impl Replay<'_, '_, '_> {
	fn add_class(&mut self, class: u32) {
		if self.seen_classes.insert(class) {
			self.classes.push(class);
		}
	}

	fn open(&mut self, event: &Event, index: u32) {
		if let Some(opaque) = self.opaque.as_mut() {
			if event.name == opaque.name {
				opaque.depth += 1;
			}
			return;
		}
		let html = self.html;
		let attributes = self.document.attributes_of(event);
		let role = || non_empty(attributes.role.as_ref().map(|value| value.decoded(html)));
		let r#type = || non_empty(attributes.r#type.as_ref().map(|value| value.decoded(html)));
		if self.stack.is_empty() {
			if event.name == TagName::BODY && !self.body_done {
				let segment = build_segment("body", &[], role().as_deref(), r#type().as_deref());
				let segment = self.ids.segment(&segment);
				self.root = self.tree.add_node(segment, false);
				self.stack.push(self.root);
			}
			return;
		}
		if event.name == TagName::BODY {
			self.ignored_body_opens += 1;
			return;
		}
		let parent = *self.stack.last().expect("stack is not empty");
		self.tree.nodes[parent as usize].child_elements += 1;

		if is_opaque(event.name) {
			self.opaque = Some(Opaque {
				name: event.name,
				depth: 1,
				content_start: event.end_index + 1,
				role: role(),
				r#type: r#type(),
			});
			return;
		}

		let info = self.cache.element(html, self.document, index, self.ids);
		let filtered = self
			.allowed
			.filter(|allowed| info.classes.iter().any(|(id, _)| !allowed.contains(id)));
		let (segment, fold_candidate, kept) = if let Some(allowed) = filtered {
			let kept: Vec<(u32, &str)> = info
				.classes
				.iter()
				.filter(|(id, _)| allowed.contains(id))
				.map(|(id, name)| (*id, &**name))
				.collect();
			let names: Vec<&str> = kept.iter().map(|(_, name)| *name).collect();
			let tag = self.document.tag_name(event.name);
			let role = info.role.as_deref();
			let r#type = info.r#type.as_deref();
			(
				Some(build_segment(tag, &names, role, r#type)),
				is_fold_candidate(tag, &names, role, r#type),
				kept.iter().map(|(id, _)| *id).collect::<Vec<u32>>(),
			)
		} else {
			(
				None,
				info.fold_candidate,
				info.classes.iter().map(|(id, _)| *id).collect(),
			)
		};
		let segment = match segment {
			Some(segment) => self.ids.segment(&segment),
			None => self.cache.elements[&index].segment,
		};
		for class in kept {
			self.add_class(class);
		}
		let node = self.tree.add_node(segment, fold_candidate);
		self.stack.push(node);
	}

	fn close(&mut self, event: &Event) {
		if let Some(current) = self.opaque.as_mut() {
			if event.name == current.name {
				current.depth -= 1;
				if current.depth == 0 {
					let current = self.opaque.take().expect("opaque is set");
					let segment = self.opaque_segment(&current, event.start_index);
					let parent = *self.stack.last().expect("an opaque element has a parent");
					self.tree.append(parent, ChildKind::Leaf(segment));
				}
			}
			return;
		}
		if event.name == TagName::BODY && self.ignored_body_opens > 0 {
			self.ignored_body_opens -= 1;
			return;
		}
		let Some(node) = self.stack.pop() else {
			return;
		};
		if let Some(&parent) = self.stack.last() {
			self.tree.append(parent, ChildKind::Element(node));
		} else {
			self.body_done = true;
		}
	}

	/// The leaf segment of an opaque element whose content ends at `end`.
	fn opaque_segment(&mut self, opaque: &Opaque, end: usize) -> u32 {
		let key = (opaque.content_start, end);
		if let Some(&segment) = self.cache.hashes.get(&key) {
			return segment;
		}
		// `slice(start, end)` with `end < start` is empty in JavaScript too.
		let raw = self.html.get(key.0..key.1).unwrap_or("");
		let segment = build_opaque_segment(
			self.document.tag_name(opaque.name),
			opaque.role.as_deref(),
			opaque.r#type.as_deref(),
			&hash_content(raw),
		);
		let segment = self.ids.segment(&segment);
		self.cache.hashes.insert(key, segment);
		segment
	}
}

/// Replays `document` (parsed from `html`) with the events of each `skip`
/// range (inclusive event indices, ascending, disjoint) left out, keeping only
/// the classes in `allowed` when given. Returns `None` when leaving a range
/// out is not the same as deleting its markup: the range sits inside an
/// opaque element, whose hash would change, or before `<body>` opened.
pub fn tokenize_events(
	html: &str,
	document: &Document,
	skips: &[(u32, u32)],
	allowed: Option<&FxHashSet<u32>>,
	cache: &mut ReplayCache,
	ids: &mut Ids,
) -> Option<Tokenized> {
	let mut replay = Replay {
		html,
		document,
		allowed,
		cache,
		ids,
		tree: Tree::default(),
		stack: Vec::new(),
		opaque: None,
		body_done: false,
		ignored_body_opens: 0,
		root: NONE,
		classes: Vec::new(),
		seen_classes: FxHashSet::default(),
	};
	let mut skips = skips.iter().peekable();
	let mut index = 0usize;
	while index < document.events.len() {
		if let Some(&&(start, end)) = skips.peek()
			&& start as usize == index
		{
			if replay.opaque.is_some() || (replay.stack.is_empty() && !replay.body_done) {
				return None;
			}
			index = end as usize + 1;
			skips.next();
			continue;
		}
		let event = &document.events[index];
		let event_index = u32::try_from(index).expect("fewer than 2^32 events");
		index += 1;
		match event.kind {
			EventKind::Open => replay.open(event, event_index),
			EventKind::Close { .. } => replay.close(event),
		}
	}
	let tokens = if replay.root == NONE {
		Vec::new()
	} else {
		replay.tree.emit(replay.root, replay.ids)
	};
	Some(Tokenized {
		tokens,
		classes: replay.classes,
	})
}

/// Parses and tokenizes `html` in full.
pub fn tokenize(html: &str, allowed: Option<&FxHashSet<u32>>, ids: &mut Ids) -> Tokenized {
	let document = parse(html);
	tokenize_events(
		html,
		&document,
		&[],
		allowed,
		&mut ReplayCache::default(),
		ids,
	)
	.expect("a replay without skipped ranges always succeeds")
}

#[cfg(test)]
mod tests {
	use rustc_hash::FxHashSet;

	use super::{ReplayCache, tokenize, tokenize_events};
	use crate::vocabulary::{Ids, Vocabulary};

	fn token_strings(html: &str) -> Vec<String> {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		tokenize(html, None, &mut ids)
			.tokens
			.into_iter()
			.map(|id| vocabulary.token(id).to_string())
			.collect()
	}

	#[test]
	fn emits_one_path_per_leaf_and_folds_bare_single_child_wrappers() {
		assert_eq!(
			token_strings("<body><div class=\"card\"><ul><li>A</li><li>B</li></ul></div></body>"),
			vec!["body>.card>ul>li"]
		);
		assert_eq!(
			token_strings("<body><div><p>x</p></div><div><p>a</p><p>b</p></div></body>"),
			vec!["body>p", "body>div>p"]
		);
	}

	#[test]
	fn leaves_out_body_classes_but_keeps_its_role() {
		assert_eq!(
			token_strings("<body class=\"law-page\" role=\"document\"><main></main></body>"),
			vec!["body[role=document]>main"]
		);
	}

	#[test]
	fn names_opaque_elements_by_their_content_hash() {
		let tokens = token_strings(
			"<body><script type=\"module\">a  b</script><svg role=img><path/></svg></body>",
		);
		assert_eq!(tokens.len(), 2);
		assert!(tokens[0].starts_with("body>script[sha="));
		assert!(tokens[0].ends_with(",type=module]"));
		assert!(tokens[1].starts_with("body>svg[role=img,sha="));
	}

	#[test]
	fn ignores_everything_outside_the_first_body_and_stray_body_tags() {
		assert_eq!(
			token_strings(
				"<head><title>t</title></head><body><nav><body><a></a></body></nav></body><body><p></p></body>"
			),
			vec!["body>nav>a"]
		);
	}

	#[test]
	fn drops_classes_outside_the_allowed_set_so_wrappers_fold() {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		let grid = ids.class("grid");
		let allowed: FxHashSet<u32> = [grid].into_iter().collect();
		let result = tokenize(
			"<body><article class=\"outline\"><div class=\"grid\"><p>x</p></div></article><span class=\"x\"><b></b></span></body>",
			Some(&allowed),
			&mut ids,
		);
		let tokens: Vec<String> = result
			.tokens
			.iter()
			.map(|id| vocabulary.token(*id).to_string())
			.collect();
		assert_eq!(tokens, vec!["body>article>.grid>p", "body>b"]);
		assert_eq!(result.classes, vec![grid]);
	}

	#[test]
	fn skips_event_ranges_as_if_their_markup_were_deleted() {
		let html =
			"<body><main><div><p>a</p><p>b</p></div><section><i></i></section></main></body>";
		let document = nitpicker_html_parser::parse(html);
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		// Events: 0 body, 1 main, 2 div, 3 p, 4 /p, 5 p, 6 /p, 7 /div,
		// 8 section, 9 i, 10 /i, 11 /section, 12 /main, 13 /body.
		let skipped = tokenize_events(
			html,
			&document,
			&[(3, 6), (9, 10)],
			None,
			&mut ReplayCache::default(),
			&mut ids,
		)
		.unwrap();
		let excised = tokenize(
			"<body><main><div></div><section></section></main></body>",
			None,
			&mut ids,
		);
		assert_eq!(skipped, excised);
	}

	#[test]
	fn refuses_to_skip_inside_an_opaque_element() {
		let html = "<body><noscript><p></p></noscript></body>";
		let document = nitpicker_html_parser::parse(html);
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		assert_eq!(
			tokenize_events(
				html,
				&document,
				&[(2, 3)],
				None,
				&mut ReplayCache::default(),
				&mut ids
			),
			None
		);
	}

	/// Tokens and class ids of `html` with the classes named in `allowed`
	/// (when given), plus the ids of `expected_classes` for comparison.
	fn run(
		html: &str,
		allowed: Option<&[&str]>,
		expected_classes: &[&str],
	) -> (Vec<String>, Vec<u32>, Vec<u32>) {
		let vocabulary = Vocabulary::default();
		let mut ids = Ids::Shared(&vocabulary);
		let allowed: Option<FxHashSet<u32>> =
			allowed.map(|names| names.iter().map(|name| ids.class(name)).collect());
		let expected: Vec<u32> = expected_classes
			.iter()
			.map(|name| ids.class(name))
			.collect();
		let result = tokenize(html, allowed.as_ref(), &mut ids);
		let tokens = result
			.tokens
			.iter()
			.map(|id| vocabulary.token(*id).to_string())
			.collect();
		(tokens, result.classes, expected)
	}

	fn strip_shas(tokens: Vec<String>) -> Vec<String> {
		tokens
			.into_iter()
			.map(|token| match token.find("sha=") {
				Some(start) => format!("{}sha=X{}", &token[..start], &token[start + 4 + 16..]),
				None => token,
			})
			.collect()
	}

	fn sha_of(token: &str) -> &str {
		let start = token.find("sha=").expect("token has a sha") + 4;
		&token[start..start + 16]
	}

	#[test]
	fn repeated_identical_cards_produce_one_distinct_path_per_leaf() {
		assert_eq!(
			token_strings(
				"<body><main class=\"product-list\"><div class=\"grid\">\
				<div class=\"card\"><img src=\"a.jpg\" class=\"thumb\" /><h3>Widget A</h3><p class=\"price\">$10</p></div>\
				<div class=\"card\"><img src=\"b.jpg\" class=\"thumb\" /><h3>Widget B</h3><p class=\"price\">$20</p></div>\
				<div class=\"card\"><img src=\"c.jpg\" class=\"thumb\" /><h3>Widget C</h3><p class=\"price\">$30</p></div>\
				</div></main></body>"
			),
			vec![
				"body>main.product-list>.grid>.card>img.thumb",
				"body>main.product-list>.grid>.card>h3",
				"body>main.product-list>.grid>.card>p.price",
			]
		);
	}

	#[test]
	fn ignores_visible_text_and_handles_mixed_leaf_and_non_leaf_paragraphs() {
		assert_eq!(
			token_strings(
				"<body><article><h1>My Blog Post Title</h1>\
				<p>Some intro text that should be completely ignored by the tokenizer.</p>\
				<p>Another paragraph with <a href=\"/x\">a link</a> inside it.</p></article></body>"
			),
			vec!["body>article>h1", "body>article>p", "body>article>p>a"]
		);
	}

	#[test]
	fn a_current_state_class_on_one_sibling_does_not_corrupt_the_others() {
		assert_eq!(
			token_strings(
				"<body><header><nav class=\"main-nav\"><ul>\
				<li><a href=\"/\">Home</a></li>\
				<li class=\"current\"><a href=\"/about\">About</a></li>\
				<li><a href=\"/contact\">Contact</a></li>\
				</ul></nav></header></body>"
			),
			vec![
				"body>header>nav.main-nav>ul>li>a",
				"body>header>nav.main-nav>ul>li.current>a",
			]
		);
	}

	#[test]
	fn keeps_input_and_button_type_as_a_structural_signal() {
		assert_eq!(
			token_strings(
				"<body><form><input type=\"text\" name=\"q\" /><input type=\"checkbox\" name=\"agree\" />\
				<input type=\"radio\" name=\"plan\" /><input type=\"email\" name=\"email\" />\
				<button type=\"submit\">Send</button></form></body>"
			),
			vec![
				"body>form>input[type=text]",
				"body>form>input[type=checkbox]",
				"body>form>input[type=radio]",
				"body>form>input[type=email]",
				"body>form>button[type=submit]",
			]
		);
	}

	#[test]
	fn names_each_svg_as_one_opaque_leaf_even_when_svgs_nest() {
		let raw = token_strings(
			"<body><div class=\"icons\">\
			<svg viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\" /></svg>\
			<svg viewBox=\"0 0 24 24\" role=\"img\"><circle cx=\"12\" cy=\"12\" r=\"10\" /></svg>\
			<svg><svg><rect width=\"10\" height=\"10\" /></svg></svg>\
			</div></body>",
		);
		assert_eq!(raw.len(), 3);
		assert_ne!(sha_of(&raw[0]), sha_of(&raw[2]));
		assert_eq!(
			strip_shas(raw),
			vec![
				"body>.icons>svg[sha=X]",
				"body>.icons>svg[role=img,sha=X]",
				"body>.icons>svg[sha=X]",
			]
		);
	}

	#[test]
	fn keeps_script_type_beside_the_content_hash() {
		assert_eq!(
			strip_shas(token_strings(
				"<body><div class=\"page\">\
				<script type=\"application/ld+json\">{ \"@type\": \"Product\", \"name\": \"Widget\" }</script>\
				<script>console.log('tracked');</script></div></body>"
			)),
			vec![
				"body>.page>script[sha=X,type=application/ld+json]",
				"body>.page>script[sha=X]",
			]
		);
	}

	#[test]
	fn collapses_wrappers_with_auto_generated_classes_via_folding() {
		assert_eq!(
			token_strings(
				"<body><div class=\"sc-a1b2c3\"><div class=\"css-4d5e6f\"><span class=\"_g7h8i9\">Label</span></div></div></body>"
			),
			vec!["body>span"]
		);
	}

	#[test]
	fn leaves_out_a_body_class_from_every_leaf_path() {
		assert_eq!(
			token_strings("<body class=\"law-page\"><header>x</header></body>"),
			vec!["body>header"]
		);
	}

	#[test]
	fn pages_differing_only_in_body_class_produce_identical_tokens() {
		let a =
			token_strings("<body class=\"law-page\"><header>x</header><footer>y</footer></body>");
		let b = token_strings(
			"<body class=\"humanities-page\"><header>x</header><footer>y</footer></body>",
		);
		assert_eq!(a, vec!["body>header", "body>footer"]);
		assert_eq!(a, b);
	}

	#[test]
	fn folds_fifty_levels_of_bare_wrapper_divs() {
		let html = format!(
			"<body>{}<span>x</span>{}</body>",
			"<div>".repeat(50),
			"</div>".repeat(50)
		);
		assert_eq!(token_strings(&html), vec!["body>span"]);
	}

	#[test]
	fn a_thousand_identical_siblings_collapse_to_one_token() {
		let html = format!("<body><ul>{}</ul></body>", "<li></li>".repeat(1000));
		assert_eq!(token_strings(&html), vec!["body>ul>li"]);
	}

	#[test]
	fn two_hundred_thousand_flat_siblings_do_not_overflow() {
		let html = format!("<body><ul>{}</ul></body>", "<li></li>".repeat(200_000));
		assert_eq!(token_strings(&html), vec!["body>ul>li"]);
	}

	#[test]
	fn recovers_unclosed_list_items_by_implicit_closing() {
		assert_eq!(
			token_strings("<body><ul><li>A<li>B</ul></body>"),
			vec!["body>ul>li"]
		);
	}

	#[test]
	fn force_closes_a_document_truncated_mid_tag() {
		assert_eq!(token_strings("<body><div><span>a"), vec!["body>span"]);
	}

	#[test]
	fn yields_no_tokens_without_a_body() {
		assert!(token_strings("<html><head><title>x</title></head></html>").is_empty());
		assert!(token_strings("").is_empty());
	}

	#[test]
	fn an_empty_body_is_itself_a_leaf() {
		assert_eq!(token_strings("<body></body>"), vec!["body"]);
	}

	#[test]
	fn ignores_a_second_top_level_body() {
		assert_eq!(
			token_strings("<body><div>1</div></body><body><div>2</div></body>"),
			vec!["body>div"]
		);
	}

	#[test]
	fn ignores_a_body_tag_nested_in_body_content_but_keeps_its_content() {
		assert_eq!(
			token_strings("<body><div><body><span>x</span></body></div></body>"),
			vec!["body>span"]
		);
	}

	#[test]
	fn ignores_comments_so_a_comment_only_element_is_a_leaf() {
		assert_eq!(
			token_strings("<body><div><!-- only comment --></div></body>"),
			vec!["body>div"]
		);
		assert_eq!(
			token_strings("<body><!-- c --><div>x</div></body>"),
			vec!["body>div"]
		);
	}

	#[test]
	fn normalizes_uppercase_tags_attributes_and_unquoted_values() {
		assert_eq!(
			token_strings("<BODY><DIV CLASS=\"Card\"  ROLE=button><SPAN>x</SPAN></DIV></BODY>"),
			vec!["body>.Card[role=button]>span"]
		);
	}

	#[test]
	fn ignores_id_data_and_non_role_aria_attributes() {
		assert_eq!(
			token_strings(
				"<body><div id=\"product-12345\" data-testid=\"card-42\" aria-label=\"Product card\" \
				aria-current=\"page\" class=\"card\"></div></body>"
			),
			vec!["body>.card"]
		);
	}

	#[test]
	fn a_childless_element_is_itself_a_leaf() {
		assert_eq!(
			token_strings("<body><div class=\"spacer\"></div></body>"),
			vec!["body>.spacer"]
		);
	}

	#[test]
	fn a_bare_wrapper_with_one_child_is_elided() {
		assert_eq!(
			token_strings("<body><div><ul><li></li></ul></div></body>"),
			vec!["body>ul>li"]
		);
	}

	#[test]
	fn a_bare_wrapper_with_two_children_keeps_its_segment() {
		assert_eq!(
			token_strings("<body><div><span></span><span></span></div></body>"),
			vec!["body>div>span"]
		);
	}

	#[test]
	fn a_classed_wrapper_always_prefixes_its_segment() {
		assert_eq!(
			token_strings("<body><div class=\"card\"><ul><li></li></ul></div></body>"),
			vec!["body>.card>ul>li"]
		);
	}

	#[test]
	fn a_bare_div_becomes_foldable_once_its_only_class_is_noise() {
		assert_eq!(
			token_strings("<body><div class=\"sc-bdVaJa\"><p></p></div></body>"),
			vec!["body>p"]
		);
		assert_eq!(
			token_strings("<body><ul class=\"nav sc-bdVaJa\"></ul></body>"),
			vec!["body>ul.nav"]
		);
	}

	#[test]
	fn matches_the_documented_examples() {
		let (tokens, classes, expected) = run(
			"<body><div class=\"card\"><ul><li>A</li><li>B</li></ul></div></body>",
			None,
			&["card"],
		);
		assert_eq!(tokens, vec!["body>.card>ul>li"]);
		assert_eq!(classes, expected);

		let (tokens, classes, expected) = run(
			"<body><article class=\"outline\"><div class=\"grid\"><p>x</p></div></article></body>",
			Some(&["grid"]),
			&["grid"],
		);
		assert_eq!(tokens, vec!["body>article>.grid>p"]);
		assert_eq!(classes, expected);
	}

	#[test]
	fn lists_each_kept_class_once_in_first_seen_order_without_body_classes() {
		let (_, classes, expected) = run(
			"<body class=\"page-home\"><header class=\"site-header\"><nav class=\"main-nav\"><a>x</a></nav></header>\
			<main><div class=\"card featured\"><p>a</p></div><div class=\"card\"><p>b</p></div></main></body>",
			None,
			&["site-header", "main-nav", "card", "featured"],
		);
		assert_eq!(classes, expected);
	}

	#[test]
	fn a_class_dropped_by_the_allowed_set_folds_its_div_away() {
		let html = "<body><div class=\"outline\"><p>x</p></div></body>";
		let (tokens, _, _) = run(html, None, &[]);
		assert_eq!(tokens, vec!["body>.outline>p"]);
		let (tokens, _, _) = run(html, Some(&[]), &[]);
		assert_eq!(tokens, vec!["body>p"]);
		let (tokens, _, _) = run(
			"<body><div class=\"outline\"><p>x</p></div></body>",
			Some(&["card"]),
			&[],
		);
		assert_eq!(tokens, vec!["body>p"]);
		// A non-foldable tag keeps its name once its only class is dropped.
		let (tokens, _, _) = run(
			"<body><article class=\"outline\"><p>x</p></article></body>",
			Some(&[]),
			&[],
		);
		assert_eq!(tokens, vec!["body>article>p"]);
	}

	#[test]
	fn the_allowed_set_does_not_touch_body_handling() {
		let (tokens, classes, _) = run("<body class=\"page-home\"><p>x</p></body>", Some(&[]), &[]);
		assert_eq!(tokens, vec!["body>p"]);
		assert!(classes.is_empty());
	}

	#[test]
	fn excludes_noise_classes_from_the_class_list() {
		let (_, classes, expected) = run(
			"<body><div class=\"card sc-bdVaJa\"><p>x</p></div></body>",
			None,
			&["card"],
		);
		assert_eq!(classes, expected);
	}

	#[test]
	fn keeps_every_non_noise_class_when_no_allowed_set_is_given() {
		let (tokens, classes, expected) = run(
			"<body><div class=\"outline grid\"><p>x</p></div></body>",
			None,
			&["grid", "outline"],
		);
		assert_eq!(tokens, vec!["body>.grid.outline>p"]);
		assert_eq!(classes, expected);
	}
}
