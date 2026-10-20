//! The evaluation plan a validated selector list is handed over as.
//!
//! JS parses and validates the selector (`css-what`), decides which comma
//! alternatives one start tag can settle (`direct`) and derives each
//! alternative's prefilter literals; this crate only evaluates the result.
//! Tag and attribute names arrive lower-cased, prefilter literals as
//! lower-cased printable ASCII.

/// How two adjacent compounds of a complex selector are joined.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Combinator {
	/// `a b`
	Descendant,
	/// `a > b`
	Child,
}

/// The attribute selector operators the engine evaluates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttributeOperator {
	/// `[a]`
	Exists,
	/// `[a=v]`
	Equals,
	/// `[a~=v]`
	Includes,
	/// `[a|=v]`
	Dash,
	/// `[a^=v]`
	Prefix,
	/// `[a$=v]`
	Suffix,
	/// `[a*=v]`
	Substring,
}

/// One attribute condition (`[a]`, `[a^=v]`, `.cls`, `#id`, ...).
#[derive(Clone, Debug)]
pub struct AttributeTest {
	/// Lower-cased attribute name.
	pub name: String,
	/// How the value is compared.
	pub operator: AttributeOperator,
	/// The selector's literal value (empty for [`AttributeOperator::Exists`]).
	pub value: String,
	/// Whether values compare ignoring ASCII case.
	pub ignore_case: bool,
}

/// An `An+B` position test (`:nth-child`, `:nth-of-type`, `:first-*`).
#[derive(Clone, Copy, Debug)]
pub struct NthTest {
	/// `true` for the `-of-type` forms, `false` for `:nth-child` / `:first-child`.
	pub of_type: bool,
	/// The `A` of `An+B`.
	pub a: f64,
	/// The `B` of `An+B`.
	pub b: f64,
}

/// The conditions one element has to meet: tag, attributes and positions.
#[derive(Clone, Debug, Default)]
pub struct Conditions {
	/// Lower-cased tag name, or `None` for any element.
	pub tag: Option<String>,
	/// Attribute conditions; all must hold.
	pub attributes: Vec<AttributeTest>,
	/// Position conditions; all must hold.
	pub nth: Vec<NthTest>,
}

/// A compound selector: its conditions and the compounds inside `:not(...)`.
#[derive(Clone, Debug, Default)]
pub struct Compound {
	/// What the element has to satisfy.
	pub conditions: Conditions,
	/// What it must not satisfy; each is a compound without negations of its own.
	pub negations: Vec<Conditions>,
}

/// One comma alternative of the selector list.
#[derive(Clone, Debug)]
pub struct Alternative {
	/// Compounds in source (ancestor-first) order: at least 1 and at most 30
	/// (a state set is one `u32` with a bit per compound). The matcher assumes
	/// this; the addon's plan conversion enforces it.
	pub compounds: Vec<Compound>,
	/// `combinators[j - 1]` joins `compounds[j - 1]` and `compounds[j]`.
	pub combinators: Vec<Combinator>,
	/// Lower-cased literals that must occur in order for the alternative to
	/// match, or `None` when none can be derived.
	pub prefilter_literals: Option<Vec<Vec<u8>>>,
	/// Whether one start tag decides this alternative (a single compound
	/// without position tests whose attribute values have a single stored
	/// form). Such alternatives are tried before the open-element stack runs,
	/// reading only the first compound and counting no sibling position, so a
	/// direct alternative with more compounds or a position test would be
	/// judged wrongly; the addon's plan conversion rejects one.
	pub direct: bool,
}

/// A validated selector list ready to be evaluated against documents.
#[derive(Clone, Debug)]
pub struct SelectorPlan {
	/// Every comma alternative.
	pub alternatives: Vec<Alternative>,
	/// Whether any alternative tests `:nth-child` / `:first-child`.
	pub needs_child_index: bool,
	/// Whether any alternative tests `:nth-of-type` / `:first-of-type`.
	pub needs_type_index: bool,
}
