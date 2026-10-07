import type { HTTPRequest } from 'puppeteer';

import { describe, expect, it, vi } from 'vitest';

import { createScopedHeaderRequestHandler } from './create-scoped-header-request-handler.js';

interface FakeRequestOptions {
	readonly handled?: () => boolean;
	readonly headers?: Record<string, string>;
	readonly continueResult?: Promise<void>;
}

/**
 * Minimal `HTTPRequest` double.
 * @param url - The request URL.
 * @param options - Resolution state, current headers, and what `continue()` returns.
 * @returns The fake request and its `continue` / `abort` spies.
 */
function fakeRequest(url: string, options: FakeRequestOptions = {}) {
	const continueSpy = vi
		.fn()
		.mockReturnValue(options.continueResult ?? Promise.resolve());
	const abortSpy = vi.fn().mockResolvedValue();
	const request = {
		url: () => url,
		headers: () => options.headers ?? { accept: '*/*', 'user-agent': 'ua' },
		isInterceptResolutionHandled: options.handled ?? (() => false),
		continue: continueSpy,
		abort: abortSpy,
	} as unknown as HTTPRequest;
	return { request, continueSpy, abortSpy };
}

/**
 * Runs `run` while collecting any `unhandledRejection`, then lets queued
 * microtasks and timers settle.
 * @param run - Invokes the handler under test.
 * @returns The `unhandledRejection` spy.
 */
async function collectUnhandled(run: () => void) {
	const unhandled = vi.fn();
	process.on('unhandledRejection', unhandled);
	try {
		run();
		await new Promise((resolve) => setTimeout(resolve, 10));
	} finally {
		process.off('unhandledRejection', unhandled);
	}
	return unhandled;
}

const inScope = (href: string) => href.startsWith('http://localhost:3000/');

describe('createScopedHeaderRequestHandler', () => {
	it('merges the extra headers into in-scope requests', () => {
		const handler = createScopedHeaderRequestHandler({
			requestHeaders: { Authorization: 'Bearer t' },
			isInScope: inScope,
		});
		const { request, continueSpy } = fakeRequest('http://localhost:3000/a');
		handler(request);
		expect(continueSpy).toHaveBeenCalledWith({
			headers: { accept: '*/*', 'user-agent': 'ua', Authorization: 'Bearer t' },
		});
	});

	it('replaces a header the page already carries instead of sending both casings', () => {
		const handler = createScopedHeaderRequestHandler({
			requestHeaders: { Authorization: 'Bearer override', 'X-Api-Key': 'k' },
			isInScope: inScope,
		});
		const { request, continueSpy } = fakeRequest('http://localhost:3000/a', {
			headers: { accept: '*/*', authorization: 'page-own', 'x-api-key': 'page-key' },
		});
		handler(request);
		expect(continueSpy).toHaveBeenCalledWith({
			headers: { accept: '*/*', Authorization: 'Bearer override', 'X-Api-Key': 'k' },
		});
	});

	it('continues out-of-scope requests untouched', () => {
		const handler = createScopedHeaderRequestHandler({
			requestHeaders: { Authorization: 'Bearer t' },
			isInScope: inScope,
		});
		const { request, continueSpy } = fakeRequest('http://127.0.0.1:3000/a');
		handler(request);
		expect(continueSpy).toHaveBeenCalledWith();
	});

	it('strips the configured headers an out-of-scope request inherited (e.g. from a redirect hop)', () => {
		const handler = createScopedHeaderRequestHandler({
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope: inScope,
		});
		const { request, continueSpy } = fakeRequest('http://127.0.0.1:3000/landing', {
			headers: { accept: '*/*', 'x-api-key': 'k' },
		});
		handler(request);
		expect(continueSpy).toHaveBeenCalledWith({ headers: { accept: '*/*' } });
	});

	it('leaves a request that another handler already resolved alone', () => {
		const handler = createScopedHeaderRequestHandler({
			requestHeaders: { Authorization: 'Bearer t' },
			isInScope: inScope,
		});
		const { request, continueSpy } = fakeRequest('http://localhost:3000/a', {
			handled: () => true,
		});
		handler(request);
		expect(continueSpy).not.toHaveBeenCalled();
	});

	it('aborts the request and reports the error when continue() rejects, without an unhandled rejection', async () => {
		const onError = vi.fn();
		const failure = new Error('Invalid header');
		const handler = createScopedHeaderRequestHandler({
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope: inScope,
			onError,
		});
		const { request, abortSpy } = fakeRequest('http://localhost:3000/a', {
			continueResult: Promise.reject(failure),
		});

		const unhandled = await collectUnhandled(() => handler(request));

		expect(onError).toHaveBeenCalledWith(failure);
		expect(abortSpy).toHaveBeenCalledWith('failed');
		expect(unhandled).not.toHaveBeenCalled();
	});

	it('does not abort a request that was resolved by the time continue() rejected', async () => {
		const handler = createScopedHeaderRequestHandler({
			requestHeaders: { 'X-Api-Key': 'k' },
			isInScope: inScope,
		});
		let resolved = false;
		const { request, abortSpy } = fakeRequest('http://localhost:3000/a', {
			handled: () => resolved,
			continueResult: new Promise<void>((_resolve, reject) => {
				setTimeout(() => {
					resolved = true;
					reject(new Error('late'));
				}, 0);
			}),
		});

		const unhandled = await collectUnhandled(() => handler(request));

		expect(abortSpy).not.toHaveBeenCalled();
		expect(unhandled).not.toHaveBeenCalled();
	});
});
