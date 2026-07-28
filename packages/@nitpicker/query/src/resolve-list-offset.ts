/**
 * Normalizes a caller-supplied row offset for an offset-paginated list
 * query, falling back to `0` when the value is missing, negative, or not an
 * integer.
 * @param offset - The requested row offset.
 * @returns A safe offset for the SQL query.
 * @example
 * const offset = resolveListOffset(20); // 20
 * const fallback = resolveListOffset(-1); // 0
 */
export function resolveListOffset(offset: number | undefined): number {
	return Number.isInteger(offset) && (offset as number) >= 0 ? (offset as number) : 0;
}
