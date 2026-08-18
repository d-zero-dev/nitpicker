import { describe, it, expect, vi } from 'vitest';

import { createCountProgressLogger } from './create-count-progress-logger.js';

describe('createCountProgressLogger', () => {
	it('formats counts with a percentage, defaulting to "pages"', () => {
		const logLine = vi.fn();
		const onProgress = createCountProgressLogger(logLine, 'Sorting pages');

		onProgress(50, 200);

		expect(logLine).toHaveBeenCalledWith('%braille% Sorting pages: 50/200 pages (25%)');
	});

	it('accepts a custom unit', () => {
		const logLine = vi.fn();
		const onProgress = createCountProgressLogger(
			logLine,
			'Resetting failed pages',
			'ids',
		);

		onProgress(3, 5);

		expect(logLine).toHaveBeenCalledWith(
			'%braille% Resetting failed pages: 3/5 ids (60%)',
		);
	});

	it('deduplicates calls that render to the same message', () => {
		const logLine = vi.fn();
		const onProgress = createCountProgressLogger(logLine, 'Sorting pages');

		onProgress(50, 200);
		onProgress(50, 200);

		expect(logLine).toHaveBeenCalledOnce();
	});

	it('logs again once the rendered message actually changes', () => {
		const logLine = vi.fn();
		const onProgress = createCountProgressLogger(logLine, 'Sorting pages');

		onProgress(50, 200);
		onProgress(60, 200);

		expect(logLine).toHaveBeenCalledTimes(2);
		expect(logLine).toHaveBeenLastCalledWith(
			'%braille% Sorting pages: 60/200 pages (30%)',
		);
	});

	it('reports completion at 100%', () => {
		const logLine = vi.fn();
		const onProgress = createCountProgressLogger(logLine, 'Sorting pages');

		onProgress(200, 200);

		expect(logLine).toHaveBeenCalledWith('%braille% Sorting pages: 200/200 pages (100%)');
	});
});
