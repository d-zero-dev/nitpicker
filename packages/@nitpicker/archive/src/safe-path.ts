import path from 'node:path';

/**
 * Resolves and validates a file path to prevent path traversal attacks.
 * Ensures the resolved path stays within the specified base directory.
 * @param base - The base directory that all paths must stay within.
 * @param segments - Path segments to resolve relative to the base.
 * @returns The resolved absolute path.
 * @throws {Error} If the resolved path escapes the base directory.
 */
export function safePath(base: string, ...segments: string[]): string {
	const resolvedBase = path.resolve(base);
	const resolved = path.resolve(base, ...segments);
	if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
		throw new Error(`Path traversal detected: ${segments.join('/')}`);
	}
	return resolved;
}
