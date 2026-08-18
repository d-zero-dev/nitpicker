import { describe, it, expect } from 'vitest';

import { formatExtractProgressLine } from './format-extract-progress-line.js';

describe('formatExtractProgressLine', () => {
	it('formats bytes as MB', () => {
		expect(formatExtractProgressLine(50_000_000, 200_000_000)).toBe(
			'Extracting archive: 50/200 MB',
		);
	});

	it('does not report a false 0/0 for an archive under 500 KB (issue #294 code review)', () => {
		expect(formatExtractProgressLine(100_000, 400_000)).toBe(
			'Extracting archive: 0/1 MB',
		);
	});

	it('reports 1/1 once a sub-500 KB archive actually completes', () => {
		expect(formatExtractProgressLine(400_000, 400_000)).toBe(
			'Extracting archive: 1/1 MB',
		);
	});
});
