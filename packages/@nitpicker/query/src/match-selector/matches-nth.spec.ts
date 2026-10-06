import { describe, expect, it } from 'vitest';

import { matchesNth } from './matches-nth.js';

describe('matchesNth', () => {
	it.each([
		[1, 0, 1, true],
		[2, 0, 1, false],
		[0, 0, 0, true],
		[3, 2, 1, true],
		[4, 2, 1, false],
		[2, 2, 0, true],
		[1, 2, 0, false],
		[1, 1, 2, false],
		[2, 1, 2, true],
		[9, 1, 2, true],
		[1, -1, 3, true],
		[3, -1, 3, true],
		[4, -1, 3, false],
		[2, 3, -1, true],
		[5, 3, -1, true],
		[3, 3, -1, false],
		[1, 3, -1, false],
	])('position %i against %in+%i → %s', (position, a, b, expected) => {
		expect(matchesNth(position, a, b)).toBe(expected);
	});
});
