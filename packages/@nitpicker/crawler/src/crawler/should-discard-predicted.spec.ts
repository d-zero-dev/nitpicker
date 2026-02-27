import type { ScrapeResult } from '@d-zero/beholder';

import { describe, expect, it } from 'vitest';

import { shouldDiscardPredicted } from './should-discard-predicted.js';

describe('shouldDiscardPredicted', () => {
	it('type=error は破棄する', () => {
		const result: ScrapeResult = {
			type: 'error',
			resources: [],
			error: { name: 'Error', message: 'connection refused', shutdown: false },
		};
		expect(shouldDiscardPredicted(result)).toBe(true);
	});

	it('type=success, status=404 は破棄する', () => {
		const result: ScrapeResult = {
			type: 'success',
			resources: [],
			pageData: {
				url: {} as never,
				redirectPaths: [],
				isTarget: false,
				isExternal: false,
				status: 404,
				statusText: 'Not Found',
				contentType: 'text/html',
				contentLength: 0,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
		};
		expect(shouldDiscardPredicted(result)).toBe(true);
	});

	it('type=success, status=500 は破棄する', () => {
		const result: ScrapeResult = {
			type: 'success',
			resources: [],
			pageData: {
				url: {} as never,
				redirectPaths: [],
				isTarget: false,
				isExternal: false,
				status: 500,
				statusText: 'Internal Server Error',
				contentType: 'text/html',
				contentLength: 0,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
		};
		expect(shouldDiscardPredicted(result)).toBe(true);
	});

	it('type=success, status=200 は保持する', () => {
		const result: ScrapeResult = {
			type: 'success',
			resources: [],
			pageData: {
				url: {} as never,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 1024,
				responseHeaders: {},
				meta: { title: 'Test' },
				anchorList: [],
				imageList: [],
				html: '<html></html>',
				isSkipped: false,
			},
		};
		expect(shouldDiscardPredicted(result)).toBe(false);
	});

	it('type=success, status=301 は保持する', () => {
		const result: ScrapeResult = {
			type: 'success',
			resources: [],
			pageData: {
				url: {} as never,
				redirectPaths: [],
				isTarget: false,
				isExternal: false,
				status: 301,
				statusText: 'Moved Permanently',
				contentType: 'text/html',
				contentLength: 0,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
		};
		expect(shouldDiscardPredicted(result)).toBe(false);
	});

	it('type=skipped は破棄する', () => {
		const result: ScrapeResult = {
			type: 'skipped',
			resources: [],
			ignored: {
				url: {} as never,
				matchedText: 'keyword',
				excludeKeywords: ['keyword'],
			},
		};
		expect(shouldDiscardPredicted(result)).toBe(true);
	});
});
