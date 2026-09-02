import type { ArchiveAccessor } from '@nitpicker/crawler';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveDirectoryPrefixes } from './resolve-directory-prefixes.js';
import { resolvePageSelection } from './resolve-page-selection.js';

const countPageListRows = vi.fn();

vi.mock('@nitpicker/query', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@nitpicker/query')>();
	return {
		...actual,
		countPageListRows: (...args: unknown[]) => countPageListRows(...args),
	};
});

vi.mock('./resolve-directory-prefixes.js', () => ({
	resolveDirectoryPrefixes: vi.fn(),
}));

const accessor = {} as ArchiveAccessor;

describe('resolvePageSelection', () => {
	beforeEach(() => {
		countPageListRows.mockReset();
		vi.mocked(resolveDirectoryPrefixes).mockReset();
	});

	it('delegates to resolveDirectoryPrefixes unchanged when urls is undefined', async () => {
		vi.mocked(resolveDirectoryPrefixes).mockResolvedValue([
			{ origin: null, pathname: '/docs', display: '/docs' },
		]);
		const onWarn = vi.fn();

		const selection = await resolvePageSelection({
			accessor,
			directoryInput: '/docs',
			interactive: true,
			onWarn,
		});

		expect(resolveDirectoryPrefixes).toHaveBeenCalledWith({
			accessor,
			initialInput: '/docs',
			interactive: true,
			onWarn,
		});
		expect(selection).toEqual({ directories: ['/docs'], urls: undefined });
		expect(countPageListRows).not.toHaveBeenCalled();
	});

	it('resolves to an empty directories list when urls is given without --html-dirs', async () => {
		countPageListRows.mockResolvedValue(3);

		const selection = await resolvePageSelection({
			accessor,
			urls: ['https://example.com/a'],
			interactive: false,
			onWarn: () => {},
		});

		expect(countPageListRows).toHaveBeenCalledWith(accessor, {
			urls: ['https://example.com/a'],
			directories: [],
		});
		expect(selection).toEqual({ directories: [], urls: ['https://example.com/a'] });
		expect(resolveDirectoryPrefixes).not.toHaveBeenCalled();
	});

	it('combines urls with a parsed --html-dirs value (AND)', async () => {
		countPageListRows.mockResolvedValue(1);

		const selection = await resolvePageSelection({
			accessor,
			directoryInput: '/docs',
			urls: ['https://example.com/docs/a'],
			interactive: false,
			onWarn: () => {},
		});

		expect(countPageListRows).toHaveBeenCalledWith(accessor, {
			urls: ['https://example.com/docs/a'],
			directories: ['/docs'],
		});
		expect(selection).toEqual({
			directories: ['/docs'],
			urls: ['https://example.com/docs/a'],
		});
	});

	it('throws without an --html-dirs mention when the urls-only total exceeds the page limit', async () => {
		countPageListRows.mockResolvedValue(10_001);

		await expect(
			resolvePageSelection({
				accessor,
				urls: ['https://example.com/a'],
				interactive: false,
				onWarn: () => {},
			}),
		).rejects.toThrow(/matched 10,001 inner page\(s\); exceeds/);
	});

	it('mentions --html-dirs narrowing in the error when a directory prefix was also given', async () => {
		countPageListRows.mockResolvedValue(10_001);

		await expect(
			resolvePageSelection({
				accessor,
				directoryInput: '/docs',
				urls: ['https://example.com/a'],
				interactive: false,
				onWarn: () => {},
			}),
		).rejects.toThrow(/after --html-dirs narrowing/);
	});
});
