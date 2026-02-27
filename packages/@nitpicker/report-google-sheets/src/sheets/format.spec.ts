import { describe, it, expect } from 'vitest';

import { booleanFormatError } from './format.js';

describe('booleanFormatError', () => {
	it('has red background color', () => {
		expect(booleanFormatError.backgroundColor).toEqual({ red: 0.9 });
	});

	it('has white text color', () => {
		expect(booleanFormatError.textFormat?.foregroundColor).toEqual({
			red: 1,
			green: 1,
			blue: 1,
		});
	});
});
