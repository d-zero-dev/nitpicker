import type { DecomposedUrl } from './decompose-url.js';

/**
 * Reconstructs a URL string from a decomposed representation with one
 * token replaced at the specified index.
 * @param decomposed - The decomposed URL to reconstruct
 * @param tokenIndex - Index in the combined token array (path segments + query values)
 * @param newValue - The replacement value for the token at `tokenIndex`
 * @returns The reconstructed URL string
 */
export function reconstructUrl(
	decomposed: DecomposedUrl,
	tokenIndex: number,
	newValue: string,
): string {
	const { host, pathSegments, queryKeys, queryValues, protocol } = decomposed;
	const newPathSegments = [...pathSegments];
	const newQueryValues = [...queryValues];

	if (tokenIndex < pathSegments.length) {
		newPathSegments[tokenIndex] = newValue;
	} else {
		newQueryValues[tokenIndex - pathSegments.length] = newValue;
	}

	let url = `${protocol}//${host}`;
	if (newPathSegments.length > 0) {
		url += `/${newPathSegments.join('/')}`;
	}
	if (queryKeys.length > 0) {
		const pairs = queryKeys.map(
			(k, i) => `${encodeURIComponent(k)}=${encodeURIComponent(newQueryValues[i] ?? '')}`,
		);
		url += `?${pairs.join('&')}`;
	}
	return url;
}
