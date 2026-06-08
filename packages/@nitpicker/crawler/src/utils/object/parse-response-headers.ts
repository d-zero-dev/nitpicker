/**
 * Parse a JSON-serialized HTTP response headers column from the archive
 * database.
 *
 * The columns hold JSON produced by `JSON.stringify` at insert time; absent,
 * malformed, or non-object JSON (the string `"null"`, arrays, primitives)
 * degrades to `null` instead of throwing because a missing header set only
 * loses fidelity — callers decide their own fallback (`?? {}` etc.).
 * @param json - The raw column value.
 * @returns The parsed header record, or `null` when absent or malformed.
 */
export function parseResponseHeaders(
	json: string | null,
): Record<string, string | string[] | undefined> | null {
	if (json == null) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(json);
		if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, string | string[] | undefined>;
	} catch {
		return null;
	}
}
