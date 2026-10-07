/**
 * Regular expression source fragments shared by the single-start-tag scan.
 *
 * Stored snapshots are serializer output, which fixes the shapes these
 * rely on: attribute values are always double-quoted, attributes are
 * separated by ASCII whitespace, and `&` appears only as one of five
 * entities (`&amp; &lt; &gt; &quot; &nbsp;`).
 * @example
 * new RegExp(`<a${START_TAG_PATTERNS.attributeSkip}*>`);
 */
export const START_TAG_PATTERNS = {
	/** One ASCII whitespace character (the only separator in a start tag). */
	whitespace: '[ \\t\\n\\r\\f]',
	/** What may follow a tag name. */
	nameEnd: '(?=[ \\t\\n\\r\\f/>])',
	/** Characters of a tag name. */
	nameCharacters: '[^ \\t\\n\\r\\f/>]',
	/** One unit of start tag content: a non-quote character or a whole quoted value. */
	attributeSkip: '(?:[^>"]|"[^"]*")',
	/**
	 * Zero or more attribute value characters, where each is a plain
	 * character or one whole entity. Placing a literal after this fragment
	 * pins the literal to an entity boundary, so `amp` never matches inside
	 * `&amp;`.
	 */
	codewordSequence: '(?:[^"&]|&(?:amp|lt|gt|quot|nbsp);)*?',
} as const;
