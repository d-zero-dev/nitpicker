import { zstdDecompressSync } from 'node:zlib';

/**
 * Decodes one `json_refs` payload back into its JSON string.
 *
 * The write path (`upsert-json-ref.ts`) and the archive-migration
 * populate (`populate-json-refs.ts`) both store bodies zstd-compressed;
 * the `'none'` codec is accepted because the `json_refs.codec` column
 * permits it, not because either writer currently produces it. Corrupt
 * bodies fail closed to `null` rather than throwing — readers treat an
 * undecodable payload the same as an absent one.
 * @param body - The raw `json_refs.json_text` body, or null when absent.
 * @param codec - The `json_refs.codec` value, or null when absent.
 * @returns The decoded JSON string, or null when there is no body or the
 *   body cannot be decoded.
 * @example
 * const metaExtras = decodeJsonRef(row.extras_body, row.extras_codec);
 */
export function decodeJsonRef(
	body: Buffer | string | null,
	codec: 'zstd' | 'none' | null,
): string | null {
	if (body == null) {
		return null;
	}
	try {
		if (codec === 'zstd') {
			return zstdDecompressSync(body as Buffer).toString('utf8');
		}
		return typeof body === 'string' ? body : body.toString('utf8');
	} catch {
		return null;
	}
}
