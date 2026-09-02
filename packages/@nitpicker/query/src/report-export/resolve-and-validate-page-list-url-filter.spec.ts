import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveAndValidatePageListUrlFilter } from './resolve-and-validate-page-list-url-filter.js';
import { resolvePageListUrlFilter } from './resolve-page-list-url-filter.js';

vi.mock('./resolve-page-list-url-filter.js', () => ({
	resolvePageListUrlFilter: vi.fn(),
}));

const accessor = {} as never;

describe('resolveAndValidatePageListUrlFilter', () => {
	beforeEach(() => {
		vi.mocked(resolvePageListUrlFilter).mockReset();
	});

	it('returns the normalized urls when at least one is valid', async () => {
		vi.mocked(resolvePageListUrlFilter).mockResolvedValue({
			urls: ['https://example.com/a'],
			unparseable: [],
		});
		const onWarn = vi.fn();

		await expect(
			resolveAndValidatePageListUrlFilter(accessor, ['https://example.com/a'], onWarn),
		).resolves.toEqual(['https://example.com/a']);
		expect(onWarn).not.toHaveBeenCalled();
	});

	it('throws when every input URL failed to normalize', async () => {
		vi.mocked(resolvePageListUrlFilter).mockResolvedValue({
			urls: [],
			unparseable: ['not a url'],
		});

		await expect(
			resolveAndValidatePageListUrlFilter(accessor, ['not a url'], vi.fn()),
		).rejects.toThrow(/--urls matched no valid HTTP\(S\) URL/);
	});

	it('warns with a count when some, but not all, input URLs are unparseable', async () => {
		vi.mocked(resolvePageListUrlFilter).mockResolvedValue({
			urls: ['https://example.com/a'],
			unparseable: ['not a url'],
		});
		const onWarn = vi.fn();

		await resolveAndValidatePageListUrlFilter(
			accessor,
			['https://example.com/a', 'not a url'],
			onWarn,
		);

		expect(onWarn).toHaveBeenCalledWith(
			expect.stringContaining('1 of 2 input URL(s) could not be parsed'),
		);
	});

	it('does not warn when every input URL is valid', async () => {
		vi.mocked(resolvePageListUrlFilter).mockResolvedValue({
			urls: ['https://example.com/a'],
			unparseable: [],
		});
		const onWarn = vi.fn();

		await resolveAndValidatePageListUrlFilter(
			accessor,
			['https://example.com/a'],
			onWarn,
		);

		expect(onWarn).not.toHaveBeenCalled();
	});
});
