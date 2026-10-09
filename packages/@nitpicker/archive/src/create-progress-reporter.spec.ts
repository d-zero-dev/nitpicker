import { describe, it, expect, vi } from 'vitest';

import { createProgressReporter } from './create-progress-reporter.js';

describe('createProgressReporter', () => {
	it('does nothing when onProgress is undefined', () => {
		const report = createProgressReporter('url_refs', 100);
		expect(() => report(50)).not.toThrow();
	});

	it('does nothing when total is 0', () => {
		const onProgress = vi.fn();
		const report = createProgressReporter('url_refs', 0, onProgress);
		report(0);
		expect(onProgress).not.toHaveBeenCalled();
	});

	it('reports on the first call that crosses a 5% tier', () => {
		const onProgress = vi.fn();
		const report = createProgressReporter('url_refs', 100, onProgress);
		report(4);
		expect(onProgress).not.toHaveBeenCalled();
		report(5);
		expect(onProgress).toHaveBeenCalledWith('url_refs: 5/100 (5%)');
	});

	it('does not re-report while still inside the same tier', () => {
		const onProgress = vi.fn();
		const report = createProgressReporter('url_refs', 100, onProgress);
		report(5);
		report(6);
		report(9);
		expect(onProgress).toHaveBeenCalledTimes(1);
	});

	it('reports 100% on the final call', () => {
		const onProgress = vi.fn();
		const report = createProgressReporter('url_refs', 100, onProgress);
		report(100);
		expect(onProgress).toHaveBeenCalledWith('url_refs: 100/100 (100%)');
	});

	it('reports every advancing tier for a small total', () => {
		const onProgress = vi.fn();
		const report = createProgressReporter('content_type_refs', 3, onProgress);
		report(1);
		report(2);
		report(3);
		expect(onProgress).toHaveBeenNthCalledWith(1, 'content_type_refs: 1/3 (33%)');
		expect(onProgress).toHaveBeenNthCalledWith(2, 'content_type_refs: 2/3 (67%)');
		expect(onProgress).toHaveBeenNthCalledWith(3, 'content_type_refs: 3/3 (100%)');
	});
});
