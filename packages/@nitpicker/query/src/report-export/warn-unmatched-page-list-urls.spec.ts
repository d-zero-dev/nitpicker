import { describe, it, expect, vi, beforeEach } from 'vitest';

import { findUnmatchedPageListUrls } from './find-unmatched-page-list-urls.js';
import { warnUnmatchedPageListUrls } from './warn-unmatched-page-list-urls.js';

vi.mock('./find-unmatched-page-list-urls.js', () => ({
	findUnmatchedPageListUrls: vi.fn(),
}));

const accessor = {} as never;

describe('warnUnmatchedPageListUrls', () => {
	beforeEach(() => {
		vi.mocked(findUnmatchedPageListUrls).mockReset();
	});

	it('warns with a count when some URLs are unmatched', async () => {
		vi.mocked(findUnmatchedPageListUrls).mockResolvedValue([
			'https://example.com/missing',
		]);
		const onWarn = vi.fn();

		await warnUnmatchedPageListUrls(
			accessor,
			['https://example.com/a', 'https://example.com/missing'],
			onWarn,
		);

		expect(onWarn).toHaveBeenCalledWith(
			expect.stringContaining('1 of 2 URL(s) were not found in the report'),
		);
		expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('query match-urls'));
	});

	it('does not warn when every URL matched', async () => {
		vi.mocked(findUnmatchedPageListUrls).mockResolvedValue([]);
		const onWarn = vi.fn();

		await warnUnmatchedPageListUrls(accessor, ['https://example.com/a'], onWarn);

		expect(onWarn).not.toHaveBeenCalled();
	});
});
