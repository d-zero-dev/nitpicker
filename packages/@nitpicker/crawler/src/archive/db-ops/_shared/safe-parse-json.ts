/**
 * Parses a JSON column value, returning `null` on parse failure rather
 * than throwing. JSON columns in `page_jsonld` (`parsed`) and `page_tags`
 * (`categories`, `sources`) are written by `JSON.stringify` and round-trip
 * cleanly under normal conditions; a hand-edited archive that has
 * malformed JSON in those columns should degrade gracefully rather than
 * propagate a parse error up to the consumer.
 * @param value - JSON-encoded text.
 * @returns Parsed value, or `null` if the input could not be parsed.
 */
export function safeParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
