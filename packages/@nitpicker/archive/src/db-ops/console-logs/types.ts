/**
 * The content fields of a `ConsoleLogEntry` that determine its identity in
 * `console_log_items` — everything except `pageUrl` / `ts`, which are
 * per-occurrence rather than per-content (see `page_console_logs`).
 */
export interface ConsoleLogContent {
	type: string;
	text: string;
	/**
	 * Pre-stringified `args` (via `stringifyConsoleLogArgs`), or `null` for
	 * an empty/unserializable args array. Callers compute this once and
	 * reuse it both for hashing here and for the `json_refs` storage
	 * decision, rather than calling `stringifyConsoleLogArgs` on the same
	 * `args` array twice.
	 */
	argsJson: string | null;
	location?: { url?: string; lineNumber?: number; columnNumber?: number };
	stack?: string;
}

/**
 * The resolved ref ids and scalar fields that make up one
 * `console_log_items` row, computed by the caller before the upsert runs.
 */
export interface ConsoleLogItemRow {
	hash: Buffer;
	type: string;
	/** `null` when `text` is the empty string — `text_refs` never stores `''`. */
	textId: number | null;
	argsJsonId: number | null;
	locUrlId: number | null;
	locLine: number | null;
	locColumn: number | null;
	stackTextId: number | null;
}
