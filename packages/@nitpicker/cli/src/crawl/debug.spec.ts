import debug from 'debug';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { log, verbosely } from './debug.js';

describe('log', () => {
	it('Nitpicker:CLI 名前空間の debug インスタンスである', () => {
		expect(log.namespace).toBe('Nitpicker:CLI');
	});
});

describe('verbosely', () => {
	afterEach(() => {
		debug.disable();
	});

	it('Nitpicker 名前空間が無効な場合、debug.enable を呼び出す', () => {
		debug.disable();
		const enableSpy = vi.spyOn(debug, 'enable');

		verbosely();

		expect(enableSpy).toHaveBeenCalledWith(
			'Nitpicker*,-Nitpicker:Crawler:Deal,-Nitpicker:Scraper:DOM:Details:*,-Nitpicker:Scraper:Resource:*',
		);
		enableSpy.mockRestore();
	});

	it('Nitpicker 名前空間がすでに有効な場合、再度 enable を呼び出さない', () => {
		debug.enable('Nitpicker*');
		const enableSpy = vi.spyOn(debug, 'enable');

		verbosely();

		expect(enableSpy).not.toHaveBeenCalled();
		enableSpy.mockRestore();
	});
});
