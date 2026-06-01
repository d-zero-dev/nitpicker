import type { DiffResult, DiffSegment } from '../types.js';

/**
 * Computes a character-level diff between two strings by stripping the common
 * prefix and suffix and marking the differing middle.
 *
 * The actual side marks its middle as `removed`, the expected side as `added`;
 * shared prefix/suffix are `common`. Lightweight (no LCS), which is enough to
 * highlight where two metadata values diverge.
 * @param actual - The actual value.
 * @param expected - The expected value.
 * @returns Per-side {@link DiffSegment} lists.
 */
export function diffText(actual: string, expected: string): DiffResult {
	const a = actual;
	const e = expected;

	let prefixLen = 0;
	const minLen = Math.min(a.length, e.length);
	while (prefixLen < minLen && a[prefixLen] === e[prefixLen]) {
		prefixLen++;
	}

	let suffixLen = 0;
	while (
		suffixLen < minLen - prefixLen &&
		a[a.length - 1 - suffixLen] === e[e.length - 1 - suffixLen]
	) {
		suffixLen++;
	}

	const prefix = a.slice(0, prefixLen);
	const suffix = suffixLen > 0 ? a.slice(a.length - suffixLen) : '';
	const actualMid = a.slice(prefixLen, a.length - suffixLen);
	const expectedMid = e.slice(prefixLen, e.length - suffixLen);

	const actualSegments: DiffSegment[] = [];
	const expectedSegments: DiffSegment[] = [];
	if (prefix) {
		actualSegments.push({ value: prefix, type: 'common' });
		expectedSegments.push({ value: prefix, type: 'common' });
	}
	if (actualMid) {
		actualSegments.push({ value: actualMid, type: 'removed' });
	}
	if (expectedMid) {
		expectedSegments.push({ value: expectedMid, type: 'added' });
	}
	if (suffix) {
		actualSegments.push({ value: suffix, type: 'common' });
		expectedSegments.push({ value: suffix, type: 'common' });
	}

	return { actual: actualSegments, expected: expectedSegments };
}
