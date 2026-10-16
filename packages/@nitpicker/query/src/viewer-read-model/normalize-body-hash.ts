/**
 * Reads a `page_meta.body_hash` cell as the driver returns it: a `BLOB` comes
 * back as an `ArrayBuffer` or as a typed array (a `Buffer` or a `Uint8Array`)
 * depending on the driver path, and `NULL` as `null`.
 * @param value - The cell.
 * @returns The bytes as a `Uint8Array` (sharing memory with `value` when it is
 *   already a view or an `ArrayBuffer`), or `null` for a `NULL` cell.
 * @example
 * normalizeBodyHash(new ArrayBuffer(32)); // Uint8Array(32)
 * normalizeBodyHash(null); // null
 */
export function normalizeBodyHash(
	value: ArrayBuffer | Uint8Array | null,
): Uint8Array | null {
	if (value === null || ArrayBuffer.isView(value)) {
		return value;
	}
	return new Uint8Array(value);
}
