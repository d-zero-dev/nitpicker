import { describe, expect, it } from 'vitest';

import { formatMissingRequestHeaderWarning } from './format-missing-request-header-warning.js';

describe('formatMissingRequestHeaderWarning', () => {
	it('lists every missing header name', () => {
		const message = formatMissingRequestHeaderWarning(['Authorization', 'X-Api-Key']);
		expect(message).toContain('Authorization, X-Api-Key');
	});

	it('tells the operator how to supply the headers again', () => {
		const message = formatMissingRequestHeaderWarning(['Authorization']);
		expect(message).toContain('--header');
		expect(message).toContain('--authorization');
		expect(message).toContain('--header-file');
	});
});
