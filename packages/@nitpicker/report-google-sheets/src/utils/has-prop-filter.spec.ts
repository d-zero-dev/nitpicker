import { describe, it, expect } from 'vitest';

import { hasPropFilter } from './has-prop-filter.js';

describe('hasPropFilter', () => {
	it('returns true when property is defined and truthy', () => {
		const filter = hasPropFilter<{ a?: string }, 'a'>('a');
		expect(filter({ a: 'hello' })).toBe(true);
	});

	it('returns false when property is undefined', () => {
		const filter = hasPropFilter<{ a?: string }, 'a'>('a');
		expect(filter({ a: undefined })).toBe(false);
	});

	it('returns false when property is empty string', () => {
		const filter = hasPropFilter<{ a?: string }, 'a'>('a');
		expect(filter({ a: '' })).toBe(false);
	});

	it('returns true when property is a function', () => {
		const filter = hasPropFilter<{ fn?: () => void }, 'fn'>('fn');
		expect(filter({ fn: () => {} })).toBe(true);
	});
});
