import type { DB_Resource } from './types.js';

import { describe, it, expect, vi } from 'vitest';

import Resource from './resource.js';

/**
 * Create a mock ArchiveAccessor with vi.fn() stubs.
 * @param overrides - Optional method overrides.
 * @returns A mock ArchiveAccessor.
 */
function createMockArchive(overrides: Record<string, unknown> = {}) {
	return {
		getReferrersOfResource: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

/**
 * Create a minimal DB_Resource for testing.
 * @param overrides - Optional field overrides.
 * @returns A DB_Resource object.
 */
function createRawResource(overrides: Partial<DB_Resource> = {}): DB_Resource {
	return {
		id: 1,
		url: 'https://example.com/style.css',
		isExternal: 0,
		status: 200,
		statusText: 'OK',
		contentType: 'text/css',
		contentLength: 1024,
		compress: 'gzip',
		cdn: 0,
		responseHeaders: null,
		...overrides,
	};
}

describe('Resource', () => {
	it('exposes url getter', () => {
		const resource = new Resource(createMockArchive() as never, createRawResource());
		expect(resource.url).toBe('https://example.com/style.css');
	});

	it('exposes status getter', () => {
		const resource = new Resource(createMockArchive() as never, createRawResource());
		expect(resource.status).toBe(200);
	});

	it('exposes statusText getter', () => {
		const resource = new Resource(createMockArchive() as never, createRawResource());
		expect(resource.statusText).toBe('OK');
	});

	it('exposes contentType getter', () => {
		const resource = new Resource(createMockArchive() as never, createRawResource());
		expect(resource.contentType).toBe('text/css');
	});

	it('exposes contentLength getter', () => {
		const resource = new Resource(createMockArchive() as never, createRawResource());
		expect(resource.contentLength).toBe(1024);
	});

	it('returns false for isExternal when flag is 0', () => {
		const resource = new Resource(
			createMockArchive() as never,
			createRawResource({ isExternal: 0 }),
		);
		expect(resource.isExternal).toBe(false);
	});

	it('returns true for isExternal when flag is 1', () => {
		const resource = new Resource(
			createMockArchive() as never,
			createRawResource({ isExternal: 1 }),
		);
		expect(resource.isExternal).toBe(true);
	});

	it('getReferrers delegates to archive', async () => {
		const mockArchive = createMockArchive({
			getReferrersOfResource: vi
				.fn()
				.mockResolvedValue(['https://a.com/', 'https://b.com/']),
		});
		const resource = new Resource(mockArchive as never, createRawResource({ id: 42 }));
		const referrers = await resource.getReferrers();
		expect(referrers).toEqual(['https://a.com/', 'https://b.com/']);
		expect(mockArchive.getReferrersOfResource).toHaveBeenCalledWith(42);
	});

	it('returns null for status when not fetched', () => {
		const resource = new Resource(
			createMockArchive() as never,
			createRawResource({ status: null }),
		);
		expect(resource.status).toBeNull();
	});
});
