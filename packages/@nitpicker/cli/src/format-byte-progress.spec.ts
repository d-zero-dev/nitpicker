import { describe, it, expect } from 'vitest';

import { formatByteProgress } from './format-byte-progress.js';

describe('formatByteProgress', () => {
	it('formats bytes as MB with a percentage', () => {
		expect(formatByteProgress(50_000_000, 200_000_000)).toBe('50/200 MB (25%)');
	});

	it('reports completion at 100%', () => {
		expect(formatByteProgress(200_000_000, 200_000_000)).toBe('200/200 MB (100%)');
	});

	it('does not report a false 100% for an archive under 500 KB (issue #294 code review)', () => {
		// A total under 500 KB rounds to 0 MB, which `formatProgressCount`
		// would otherwise read as "nothing to do" and report 100% before
		// extraction even starts.
		expect(formatByteProgress(100_000, 400_000)).toBe('0/1 MB (0%)');
	});

	it('reports 100% once a sub-500 KB archive actually completes', () => {
		expect(formatByteProgress(400_000, 400_000)).toBe('1/1 MB (100%)');
	});

	it('clamps the processed count to the total once bytes reaches or exceeds it', () => {
		// A stream can report a final chunk slightly larger than the
		// estimated total (tar padding, etc.) — must still read 100%, not
		// "201/200 MB".
		expect(formatByteProgress(201_000_000, 200_000_000)).toBe('200/200 MB (100%)');
	});

	it('reports 0/0 MB (100%) when totalBytes is exactly zero', () => {
		// A genuinely empty total (as opposed to "under 500 KB") has nothing
		// to floor at 1 MB — `formatProgressCount`'s own `total === 0` rule
		// applies unmodified.
		expect(formatByteProgress(0, 0)).toBe('0/0 MB (100%)');
	});
});
