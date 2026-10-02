import { describe, it, expect } from 'vitest';

import { getStatusLabel } from './get-status-label.js';

const t = (key: string) => (key === 'common.statusFetchError' ? 'Fetch error' : key);

describe('getStatusLabel', () => {
	it('labels the internal -1 sentinel as a fetch error', () => {
		expect(getStatusLabel(-1, t)).toBe('Fetch error');
	});

	it('keeps real HTTP statuses numeric', () => {
		expect(getStatusLabel(200, t)).toBe('200');
		expect(getStatusLabel(404, t)).toBe('404');
	});

	it('returns null when no status was recorded', () => {
		expect(getStatusLabel(null, t)).toBeNull();
		expect(getStatusLabel(undefined, t)).toBeNull();
	});
});
