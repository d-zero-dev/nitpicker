//! Tag-name interning: every name htmlparser2's tables (and this crate's
//! users) compare against gets a fixed id, so those comparisons are integer
//! comparisons; any other name gets the next free id of its document.

use rustc_hash::FxHashMap;

/// An interned tag name, unique within one [`crate::Document`]. Names are as
/// htmlparser2 reports them: lower-cased, with SVG's camel-cased adjustments
/// applied (`foreignObject`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub struct TagName(pub u32);

#[allow(missing_docs)]
impl TagName {
	pub const A: Self = Self(0);
	pub const ADDRESS: Self = Self(1);
	pub const ANNOTATION_XML: Self = Self(2);
	pub const AREA: Self = Self(3);
	pub const ARTICLE: Self = Self(4);
	pub const ASIDE: Self = Self(5);
	pub const BASE: Self = Self(6);
	pub const BASEFONT: Self = Self(7);
	pub const BLOCKQUOTE: Self = Self(8);
	pub const BODY: Self = Self(9);
	pub const BR: Self = Self(10);
	pub const BUTTON: Self = Self(11);
	pub const COL: Self = Self(12);
	pub const COMMAND: Self = Self(13);
	pub const DATALIST: Self = Self(14);
	pub const DD: Self = Self(15);
	pub const DESC: Self = Self(16);
	pub const DETAILS: Self = Self(17);
	pub const DIV: Self = Self(18);
	pub const DL: Self = Self(19);
	pub const DT: Self = Self(20);
	pub const EMBED: Self = Self(21);
	pub const FIELDSET: Self = Self(22);
	pub const FIGCAPTION: Self = Self(23);
	pub const FIGURE: Self = Self(24);
	pub const FOOTER: Self = Self(25);
	pub const FOREIGN_OBJECT: Self = Self(26);
	pub const FORM: Self = Self(27);
	pub const FRAME: Self = Self(28);
	pub const H1: Self = Self(29);
	pub const H2: Self = Self(30);
	pub const H3: Self = Self(31);
	pub const H4: Self = Self(32);
	pub const H5: Self = Self(33);
	pub const H6: Self = Self(34);
	pub const HEAD: Self = Self(35);
	pub const HEADER: Self = Self(36);
	pub const HR: Self = Self(37);
	pub const IMAGE: Self = Self(38);
	pub const IMG: Self = Self(39);
	pub const INPUT: Self = Self(40);
	pub const ISINDEX: Self = Self(41);
	pub const KEYGEN: Self = Self(42);
	pub const LI: Self = Self(43);
	pub const LINK: Self = Self(44);
	pub const MAIN: Self = Self(45);
	pub const MATH: Self = Self(46);
	pub const META: Self = Self(47);
	pub const MI: Self = Self(48);
	pub const MN: Self = Self(49);
	pub const MO: Self = Self(50);
	pub const MS: Self = Self(51);
	pub const MTEXT: Self = Self(52);
	pub const NAV: Self = Self(53);
	pub const NOSCRIPT: Self = Self(54);
	pub const OL: Self = Self(55);
	pub const OPTGROUP: Self = Self(56);
	pub const OPTION: Self = Self(57);
	pub const OUTPUT: Self = Self(58);
	pub const P: Self = Self(59);
	pub const PARAM: Self = Self(60);
	pub const PRE: Self = Self(61);
	pub const RP: Self = Self(62);
	pub const RT: Self = Self(63);
	pub const SCRIPT: Self = Self(64);
	pub const SEARCH: Self = Self(65);
	pub const SECTION: Self = Self(66);
	pub const SELECT: Self = Self(67);
	pub const SOURCE: Self = Self(68);
	pub const SPAN: Self = Self(69);
	pub const STYLE: Self = Self(70);
	pub const SVG: Self = Self(71);
	pub const TABLE: Self = Self(72);
	pub const TBODY: Self = Self(73);
	pub const TD: Self = Self(74);
	pub const TEXTAREA: Self = Self(75);
	pub const TFOOT: Self = Self(76);
	pub const TH: Self = Self(77);
	pub const THEAD: Self = Self(78);
	pub const TITLE: Self = Self(79);
	pub const TR: Self = Self(80);
	pub const TRACK: Self = Self(81);
	pub const UL: Self = Self(82);
	pub const WBR: Self = Self(83);
}

/// The names behind the constants above, in id order.
const KNOWN_TAG_NAMES: [&str; 84] = [
	"a",
	"address",
	"annotation-xml",
	"area",
	"article",
	"aside",
	"base",
	"basefont",
	"blockquote",
	"body",
	"br",
	"button",
	"col",
	"command",
	"datalist",
	"dd",
	"desc",
	"details",
	"div",
	"dl",
	"dt",
	"embed",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"foreignObject",
	"form",
	"frame",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"head",
	"header",
	"hr",
	"image",
	"img",
	"input",
	"isindex",
	"keygen",
	"li",
	"link",
	"main",
	"math",
	"meta",
	"mi",
	"mn",
	"mo",
	"ms",
	"mtext",
	"nav",
	"noscript",
	"ol",
	"optgroup",
	"option",
	"output",
	"p",
	"param",
	"pre",
	"rp",
	"rt",
	"script",
	"search",
	"section",
	"select",
	"source",
	"span",
	"style",
	"svg",
	"table",
	"tbody",
	"td",
	"textarea",
	"tfoot",
	"th",
	"thead",
	"title",
	"tr",
	"track",
	"ul",
	"wbr",
];

/// Per-document name table, seeded with [`KNOWN_TAG_NAMES`].
#[derive(Debug)]
pub(crate) struct TagNames {
	names: Vec<Box<str>>,
	ids: FxHashMap<Box<str>, TagName>,
}

impl Default for TagNames {
	fn default() -> Self {
		let mut table = Self {
			names: Vec::with_capacity(KNOWN_TAG_NAMES.len() + 16),
			ids: FxHashMap::default(),
		};
		for name in KNOWN_TAG_NAMES {
			table.intern(name);
		}
		table
	}
}

impl TagNames {
	pub(crate) fn intern(&mut self, name: &str) -> TagName {
		if let Some(&id) = self.ids.get(name) {
			return id;
		}
		let id = TagName(u32::try_from(self.names.len()).expect("fewer than 2^32 tag names"));
		self.names.push(name.into());
		self.ids.insert(name.into(), id);
		id
	}

	pub(crate) fn name(&self, id: TagName) -> &str {
		&self.names[id.0 as usize]
	}
}

#[cfg(test)]
mod tests {
	use super::{KNOWN_TAG_NAMES, TagName, TagNames};

	#[test]
	fn gives_every_known_name_its_constant() {
		let table = TagNames::default();
		for (index, name) in KNOWN_TAG_NAMES.iter().enumerate() {
			assert_eq!(table.name(TagName(u32::try_from(index).unwrap())), *name);
		}
		assert_eq!(table.name(TagName::BODY), "body");
		assert_eq!(table.name(TagName::FOREIGN_OBJECT), "foreignObject");
		assert_eq!(table.name(TagName::WBR), "wbr");
	}

	#[test]
	fn appends_unknown_names_after_the_known_ones() {
		let mut table = TagNames::default();
		let custom = table.intern("my-widget");
		assert_eq!(custom, TagName(84));
		assert_eq!(table.intern("my-widget"), custom);
		assert_eq!(table.intern("div"), TagName::DIV);
	}
}
