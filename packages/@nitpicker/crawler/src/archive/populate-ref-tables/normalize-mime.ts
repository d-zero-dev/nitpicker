/**
 * Normalises a raw Content-Type header value to the canonical MIME form
 * stored in `content_type_refs.normalized`: parameters (`; charset=...`)
 * removed, C0 control characters (`0x00`..`0x1F`) and DEL (`0x7F`)
 * stripped, trimmed, lower-cased.
 *
 * This is a derived column shared by two writers — the live-crawl upsert
 * (`db-ops/_shared/upsert-content-type-ref.ts`) and the archive-migration
 * populate (`populate-content-type-refs.ts`) — which MUST be
 * same-input-same-output; a fork would split the dictionary so the same
 * raw content-type maps to different normalized values depending on
 * whether the row was crawled live or migrated. Keeping the single
 * implementation here is what enforces that.
 *
 * Control chars are dropped character-by-character rather than via a
 * regex literal so the source file carries no non-printing bytes and
 * stays tool-friendly. `jsdom` / lax parsers occasionally emit them
 * inside a raw Content-Type header (e.g. `text/html\r`).
 * @param raw - Raw Content-Type header, guaranteed non-null non-empty.
 * @returns Lower-cased MIME with parameters and control chars stripped.
 * @example
 * normalizeMime('Text/HTML; charset=UTF-8'); // => 'text/html'
 */
export function normalizeMime(raw: string): string {
	const semi = raw.indexOf(';');
	const head = semi === -1 ? raw : raw.slice(0, semi);
	let output = '';
	for (const ch of head) {
		const code = ch.codePointAt(0)!;
		if (code < 32 /* 0x20 = SPACE */ || code === 127 /* 0x7F = DEL */) {
			continue;
		}
		output += ch;
	}
	return output.trim().toLowerCase();
}
