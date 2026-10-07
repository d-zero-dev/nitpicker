import type { ApplyRequestHeaderInterceptionParams } from './types.js';
import type { Page } from 'puppeteer';

import { createScopedHeaderRequestHandler } from './create-scoped-header-request-handler.js';

/**
 * Turns on request interception for `page` and attaches the user-supplied
 * extra headers to its in-scope requests — or does nothing at all when no
 * headers were configured.
 *
 * The no-op for `undefined` / empty headers is the contract that keeps the
 * default crawl path free of the per-request CDP round-trip interception adds
 * (and of any change to caching behaviour), so it is pinned by a unit test.
 * The caller also skips this for external pages: nothing of theirs is in
 * scope, so interception would only slow them down.
 * @param page - The Puppeteer page about to navigate.
 * @param params - Headers, scope predicate and error sink.
 * @returns Resolves once interception is configured (or immediately for a no-op).
 * @example
 * await applyRequestHeaderInterception(page, {
 *   requestHeaders: { Authorization: 'Bearer token' },
 *   isInScope: (href) => href.startsWith('https://example.com/'),
 * });
 */
export async function applyRequestHeaderInterception(
	page: Pick<Page, 'on' | 'setRequestInterception'>,
	params: ApplyRequestHeaderInterceptionParams,
): Promise<void> {
	const { requestHeaders, isInScope, onError } = params;
	if (!requestHeaders || Object.keys(requestHeaders).length === 0) {
		return;
	}
	await page.setRequestInterception(true);
	page.on(
		'request',
		createScopedHeaderRequestHandler({ requestHeaders, isInScope, onError }),
	);
}
