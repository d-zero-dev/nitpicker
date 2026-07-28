/**
 * Serializes a console call's argument array to a JSON string, or `null`
 * when there is nothing worth storing.
 *
 * Two cases collapse to `null` rather than an empty/degenerate string:
 * an empty `args` array (most commonly a `"pageerror"` entry, which
 * beholder always reports with `args: []`) and a `JSON.stringify` failure
 * (e.g. a circular reference in a logged object) — both mean "no
 * additional structured payload beyond `text`", not "a malformed one".
 * @param args - The `ConsoleLogEntry.args` array to serialize.
 * @returns The JSON string, or `null` when empty or unserializable.
 * @example
 * stringifyConsoleLogArgs(['a', 1]); // '["a",1]'
 * stringifyConsoleLogArgs([]); // null
 */
export function stringifyConsoleLogArgs(args: readonly unknown[]): string | null {
	if (args.length === 0) {
		return null;
	}
	try {
		return JSON.stringify(args);
	} catch {
		return null;
	}
}
