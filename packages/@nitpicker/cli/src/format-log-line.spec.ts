import { describe, it, expect } from 'vitest';

import { formatLogLine } from './format-log-line.js';

describe('formatLogLine', () => {
	it('returns the message unchanged when not verbose', () => {
		expect(formatLogLine(false, 'Extracting archive')).toBe('Extracting archive');
	});

	it('prefixes an ISO 8601 timestamp when verbose', () => {
		const result = formatLogLine(true, 'Extracting archive');
		expect(result).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z Extracting archive$/,
		);
	});
});
