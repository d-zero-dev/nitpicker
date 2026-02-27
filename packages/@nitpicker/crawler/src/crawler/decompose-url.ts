/**
 * Intermediate representation of a URL split into comparable tokens.
 * Used by pagination detection to identify which token changed between two URLs.
 */
export interface DecomposedUrl {
	/** Hostname including port (e.g. `"example.com:8080"`). */
	host: string;
	/** Path segments split by `/` (e.g. `["page", "2"]` for `/page/2`). */
	pathSegments: string[];
	/** Sorted query parameter keys. */
	queryKeys: string[];
	/** Query parameter values sorted by their corresponding key. */
	queryValues: string[];
	/** Protocol prefix (e.g. `"https:"`) or empty string if protocol-agnostic. */
	protocol: string;
}

/**
 * Decomposes a URL string into its constituent tokens for comparison.
 * Handles both full URLs (`https://host/path?q=v`) and protocol-agnostic
 * URLs (`//host/path?q=v`). Query parameters are sorted by key for
 * consistent comparison.
 * @param url - The URL string to decompose
 * @returns The decomposed URL, or `null` if the format is invalid
 */
export function decomposeUrl(url: string): DecomposedUrl | null {
	// URL format: //host/path?query  or  //host?query  (protocol-agnostic)
	// Also handle protocol://host/path?query
	let work = url;
	let protocol = '';

	// Strip protocol
	const protoMatch = /^(https?:)?\/\//.exec(work);
	if (!protoMatch) return null;
	protocol = protoMatch[1] ?? '';
	work = work.slice(protoMatch[0].length);

	// Split host from rest
	const slashIdx = work.indexOf('/');
	const qmarkIdx = work.indexOf('?');

	let host: string;
	let pathPart: string;
	let queryPart: string;

	if (slashIdx === -1 && qmarkIdx === -1) {
		host = work;
		pathPart = '';
		queryPart = '';
	} else if (slashIdx === -1) {
		host = work.slice(0, qmarkIdx);
		pathPart = '';
		queryPart = work.slice(qmarkIdx + 1);
	} else {
		host = work.slice(0, slashIdx);
		const pathAndQuery = work.slice(slashIdx + 1);
		const pq = pathAndQuery.indexOf('?');
		if (pq === -1) {
			pathPart = pathAndQuery;
			queryPart = '';
		} else {
			pathPart = pathAndQuery.slice(0, pq);
			queryPart = pathAndQuery.slice(pq + 1);
		}
	}

	const pathSegments = pathPart ? pathPart.split('/') : [];

	// Parse query into sorted key-value pairs
	const queryPairs: [string, string][] = [];
	if (queryPart) {
		for (const pair of queryPart.split('&')) {
			const eqIdx = pair.indexOf('=');
			if (eqIdx === -1) {
				queryPairs.push([pair, '']);
			} else {
				queryPairs.push([pair.slice(0, eqIdx), pair.slice(eqIdx + 1)]);
			}
		}
	}
	queryPairs.sort((a, b) => a[0].localeCompare(b[0]));

	return {
		host,
		pathSegments,
		queryKeys: queryPairs.map(([k]) => k),
		queryValues: queryPairs.map(([, v]) => v),
		protocol,
	};
}
