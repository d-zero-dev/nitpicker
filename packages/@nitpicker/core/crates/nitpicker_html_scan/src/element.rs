use crate::start_tag_attributes::{StartTagAttribute, read_start_tag_attributes};

/// The element a compound is tested against. One value is reused for every
/// element of a document, so its attribute buffer is allocated once.
#[derive(Debug)]
pub struct Element<'a> {
	name: &'a [u8],
	attribute_source: &'a [u8],
	attributes: Vec<StartTagAttribute<'a>>,
	attributes_read: bool,
	/// 1-based position among sibling elements.
	pub child_index: u32,
	/// 1-based position among sibling elements of the same name.
	pub type_index: u32,
}

impl<'a> Element<'a> {
	/// An element with no name yet.
	#[must_use]
	pub fn new() -> Self {
		Self {
			name: b"",
			attribute_source: b"",
			attributes: Vec::new(),
			attributes_read: false,
			child_index: 0,
			type_index: 0,
		}
	}

	/// Points the value at the next element. The attributes are read only
	/// when a test asks for them.
	pub fn set(&mut self, name: &'a [u8], attribute_source: &'a [u8]) {
		self.name = name;
		self.attribute_source = attribute_source;
		self.attributes_read = false;
	}

	/// The tag name as written.
	#[must_use]
	pub fn name(&self) -> &'a [u8] {
		self.name
	}

	/// The attributes, read from the start tag text on first use.
	pub fn attributes(&mut self) -> &[StartTagAttribute<'a>] {
		if !self.attributes_read {
			read_start_tag_attributes(self.attribute_source, &mut self.attributes);
			self.attributes_read = true;
		}
		&self.attributes
	}
}

impl Default for Element<'_> {
	fn default() -> Self {
		Self::new()
	}
}
