import type { PaginationPattern } from './types.js';

import { decomposeUrl } from './decompose-url.js';

/**
 * Compares two consecutive URL strings and detects a single-token numeric
 * pagination pattern (e.g. `/page/1` → `/page/2`, or `?p=1` → `?p=2`).
 *
 * The algorithm decomposes each URL into tokens (path segments + sorted query values),
 * then checks that exactly one token differs and both values are integers with a
 * positive step. Returns `null` when no pattern is detected.
 *
 * WHY single-token constraint: Multi-token differences (e.g. both path and query
 * changing) indicate different routes rather than pagination, so they are rejected.
 * @param prevUrl - The previously pushed URL (protocol-agnostic, without hash/auth)
 * @param currentUrl - The newly discovered URL
 * @returns The detected pattern, or `null` if no pagination pattern was found
 */
export function detectPaginationPattern(
	prevUrl: string,
	currentUrl: string,
): PaginationPattern | null {
	const prev = decomposeUrl(prevUrl);
	const curr = decomposeUrl(currentUrl);
	if (!prev || !curr) return null;

	// Host (including port) must match
	if (prev.host !== curr.host) return null;

	// Path segment count must match
	if (prev.pathSegments.length !== curr.pathSegments.length) return null;

	// Query key sets must match in count and identity
	if (prev.queryKeys.length !== curr.queryKeys.length) return null;
	for (let i = 0; i < prev.queryKeys.length; i++) {
		if (prev.queryKeys[i] !== curr.queryKeys[i]) return null;
	}

	// Build combined token arrays: path segments + query values (sorted by key)
	const prevTokens = [...prev.pathSegments, ...prev.queryValues];
	const currTokens = [...curr.pathSegments, ...curr.queryValues];

	let diffIndex = -1;
	for (const [i, prevToken] of prevTokens.entries()) {
		if (prevToken !== currTokens[i]) {
			if (diffIndex !== -1) return null; // more than one difference
			diffIndex = i;
		}
	}

	if (diffIndex === -1) return null; // identical URLs

	const prevNum = Number(prevTokens[diffIndex]);
	const currNum = Number(currTokens[diffIndex]);
	if (!Number.isFinite(prevNum) || !Number.isFinite(currNum)) return null;
	if (!Number.isInteger(prevNum) || !Number.isInteger(currNum)) return null;

	const step = currNum - prevNum;
	if (step <= 0) return null;

	return {
		tokenIndex: diffIndex,
		step,
		currentNumber: currNum,
	};
}
