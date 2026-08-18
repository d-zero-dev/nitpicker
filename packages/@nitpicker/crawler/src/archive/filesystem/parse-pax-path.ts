/**
 * Parses a PAX extended header record block for the `path` key.
 *
 * Format: a sequence of `"<record-length> <key>=<value>\n"` records, where
 * `<record-length>` is the decimal byte length of the ENTIRE record
 * (including the length prefix itself and the trailing newline). `tar`
 * (node-tar) emits one of these ahead of any entry whose name doesn't fit
 * the ustar format's 100-byte field (UTF-8 multi-byte names, or names
 * longer than 100 bytes) — verified empirically against this package's own
 * `tar()`/`create()` output.
 * @param data - The PAX header entry's raw data payload.
 * @returns The `path` value if present, otherwise `null`.
 * @example
 * ```ts
 * parsePaxPath(Buffer.from('20 path=日本語/\n', 'utf8')); // '日本語/'
 * ```
 */
export function parsePaxPath(data: Buffer): string | null {
	let offset = 0;
	while (offset < data.length) {
		const spaceIndex = data.indexOf(0x20 /* ' ' */, offset);
		if (spaceIndex === -1) {
			return null;
		}
		const lengthText = data.subarray(offset, spaceIndex).toString('latin1');
		const recordLength = Number.parseInt(lengthText, 10);
		if (!Number.isFinite(recordLength) || recordLength <= 0) {
			return null;
		}
		const recordEnd = offset + recordLength;
		if (recordEnd > data.length) {
			return null;
		}
		// Decimal (not `0x3D`) to sidestep the Prettier/eslint hex-case
		// conflict — see `parse-tar-size-field.ts` for the full explanation.
		const equalsIndex = data.indexOf(61 /* '=' */, spaceIndex);
		if (equalsIndex !== -1 && equalsIndex < recordEnd) {
			const key = data.subarray(spaceIndex + 1, equalsIndex).toString('utf8');
			if (key === 'path') {
				// Value runs from after '=' to just before the trailing '\n'.
				return data.subarray(equalsIndex + 1, recordEnd - 1).toString('utf8');
			}
		}
		offset = recordEnd;
	}
	return null;
}
