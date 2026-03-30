import { describe, it, expect } from 'vitest';

import { CrawlAggregateError } from './crawl-aggregate-error.js';

/**
 * Creates a mock CrawlerError-like object for testing.
 * @param isExternal
 */
function createCrawlerError(isExternal: boolean) {
	return {
		pid: 1,
		isExternal,
		name: 'CrawlerError',
		message: 'test error',
		error: new Error('test error'),
	};
}

describe('CrawlAggregateError', () => {
	it('hasOnlyExternalErrors is true when all errors are external', () => {
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(true),
		]);
		expect(error.hasOnlyExternalErrors).toBe(true);
	});

	it('hasOnlyExternalErrors is false when mixed errors', () => {
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(false),
		]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('hasOnlyExternalErrors is false for internal errors only', () => {
		const error = new CrawlAggregateError([createCrawlerError(false)]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('treats plain Error as internal error', () => {
		const error = new CrawlAggregateError([new Error('plain error')]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('hasOnlyExternalErrors is false for empty array', () => {
		const error = new CrawlAggregateError([]);
		expect(error.hasOnlyExternalErrors).toBe(false);
		expect(error.errors).toHaveLength(0);
	});

	it('message includes external breakdown', () => {
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(true),
		]);
		expect(error.message).toBe('Crawl completed with 2 error(s) (2 external).');
	});

	it('message includes mixed breakdown', () => {
		const error = new CrawlAggregateError([
			createCrawlerError(false),
			createCrawlerError(true),
			createCrawlerError(false),
		]);
		expect(error.message).toBe(
			'Crawl completed with 3 error(s) (2 internal, 1 external).',
		);
	});

	it('stores errors as readonly array', () => {
		const errors = [createCrawlerError(true), new Error('test')];
		const error = new CrawlAggregateError(errors);
		expect(error.errors).toHaveLength(2);
	});

	it('is an instance of Error', () => {
		const error = new CrawlAggregateError([]);
		expect(error).toBeInstanceOf(Error);
	});
});
