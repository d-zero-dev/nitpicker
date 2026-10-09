import type { AliasKeyParts } from './types.js';

/**
 * Formats parsed alias-key parts into a single string key. `host`/`port`
 * never contain `/` or `?`, and `path`/`search` always start with those
 * characters respectively (or `search` is empty), so concatenation without
 * an explicit delimiter is unambiguous.
 * @param parts - The parts to format.
 * @returns The formatted key string.
 * @example
 * formatAliasKey({ host: 'example.com', port: '', path: '/about/', search: '' });
 * // 'example.com/about/'
 */
export function formatAliasKey(parts: AliasKeyParts): string {
	return `${parts.host}${parts.port ? `:${parts.port}` : ''}${parts.path}${parts.search}`;
}
