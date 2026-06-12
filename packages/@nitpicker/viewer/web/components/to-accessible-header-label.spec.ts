import { describe, expect, it } from 'vitest';

import { toAccessibleHeaderLabel } from './to-accessible-header-label.js';

describe('toAccessibleHeaderLabel', () => {
	it('非空の文字列ヘッダーはそのまま返す', () => {
		expect(toAccessibleHeaderLabel('Title')).toBe('Title');
	});

	it('空文字列は undefined を返す（空の aria-label を避ける）', () => {
		expect(toAccessibleHeaderLabel('')).toBeUndefined();
	});

	it('関数（JSX レンダラ）は undefined を返す', () => {
		expect(toAccessibleHeaderLabel(() => null)).toBeUndefined();
	});

	it('undefined は undefined を返す', () => {
		expect(toAccessibleHeaderLabel()).toBeUndefined();
	});
});
