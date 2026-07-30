import { describe, expect, it } from 'vitest';

import { isShapeCapped } from './is-shape-capped.js';

describe('isShapeCapped', () => {
	it('sticky に含まれていればtrue', () => {
		const sticky = new Set(['example.com/news/date/{n}/']);
		expect(isShapeCapped(sticky, 'example.com/news/date/{n}/')).toBe(true);
	});

	it('sticky に含まれていなければfalse', () => {
		const sticky = new Set(['example.com/news/date/{n}/']);
		expect(isShapeCapped(sticky, 'example.com/other/')).toBe(false);
	});
});
