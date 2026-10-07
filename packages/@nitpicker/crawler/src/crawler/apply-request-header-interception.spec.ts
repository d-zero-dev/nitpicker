import type { Page } from 'puppeteer';

import { describe, expect, it, vi } from 'vitest';

import { applyRequestHeaderInterception } from './apply-request-header-interception.js';

/**
 * Minimal `Page` double.
 * @returns The fake page and its spies.
 */
function fakePage() {
	const setRequestInterception = vi.fn().mockResolvedValue();
	const on = vi.fn();
	return {
		page: { setRequestInterception, on } as unknown as Pick<
			Page,
			'on' | 'setRequestInterception'
		>,
		setRequestInterception,
		on,
	};
}

const isInScope = () => true;

describe('applyRequestHeaderInterception', () => {
	it('does nothing when no headers are configured', async () => {
		const { page, setRequestInterception, on } = fakePage();
		await applyRequestHeaderInterception(page, { requestHeaders: undefined, isInScope });
		expect(setRequestInterception).not.toHaveBeenCalled();
		expect(on).not.toHaveBeenCalled();
	});

	it('does nothing for an empty header map', async () => {
		const { page, setRequestInterception, on } = fakePage();
		await applyRequestHeaderInterception(page, { requestHeaders: {}, isInScope });
		expect(setRequestInterception).not.toHaveBeenCalled();
		expect(on).not.toHaveBeenCalled();
	});

	it('enables interception and registers a request handler when headers are configured', async () => {
		const { page, setRequestInterception, on } = fakePage();
		await applyRequestHeaderInterception(page, {
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope,
		});
		expect(setRequestInterception).toHaveBeenCalledWith(true);
		expect(on).toHaveBeenCalledWith('request', expect.any(Function));
	});
});
