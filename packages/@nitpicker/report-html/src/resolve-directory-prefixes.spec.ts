import type { ArchiveAccessor } from '@nitpicker/crawler';

import enquirer from 'enquirer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HtmlReportCancelledError } from './html-report-cancelled-error.js';
import { resolveDirectoryPrefixes } from './resolve-directory-prefixes.js';

const countPageListRows = vi.fn();
const countPageListHostnames = vi.fn();

vi.mock('@nitpicker/query', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@nitpicker/query')>();
	return {
		...actual,
		countPageListRows: (...args: unknown[]) => countPageListRows(...args),
		countPageListHostnames: (...args: unknown[]) => countPageListHostnames(...args),
	};
});

vi.mock('enquirer', () => ({
	default: {
		prompt: vi.fn(),
	},
}));

const accessor = {} as ArchiveAccessor;

describe('resolveDirectoryPrefixes', () => {
	afterEach(() => {
		countPageListRows.mockReset();
		countPageListHostnames.mockReset();
		vi.mocked(enquirer.prompt).mockReset();
	});

	it('skips filtering when the archive is already within the page limit', async () => {
		countPageListRows.mockResolvedValue(12);
		countPageListHostnames.mockResolvedValue(1);

		await expect(
			resolveDirectoryPrefixes({
				accessor,
				interactive: false,
				onWarn: () => {},
			}),
		).resolves.toEqual([]);
	});

	it('applies an explicit prefix even when the unfiltered total is within the limit', async () => {
		countPageListRows.mockImplementation(
			(_accessor: ArchiveAccessor, options?: { directories?: string[] }) => {
				if (!options?.directories) {
					return Promise.resolve(12);
				}
				return Promise.resolve(4);
			},
		);
		countPageListHostnames.mockResolvedValue(1);

		await expect(
			resolveDirectoryPrefixes({
				accessor,
				initialInput: '/docs',
				interactive: false,
				onWarn: () => {},
			}),
		).resolves.toEqual([{ origin: null, pathname: '/docs', display: '/docs' }]);
	});

	it('requires --html-dirs in a non-interactive over-limit run', async () => {
		countPageListRows.mockResolvedValue(10_001);
		countPageListHostnames.mockResolvedValue(1);

		await expect(
			resolveDirectoryPrefixes({
				accessor,
				interactive: false,
				onWarn: () => {},
			}),
		).rejects.toThrow(/--html-dirs/);
	});

	it('rejects pathname-only prefixes when inner pages span multiple hosts', async () => {
		countPageListRows.mockResolvedValue(10_001);
		countPageListHostnames.mockResolvedValue(2);

		await expect(
			resolveDirectoryPrefixes({
				accessor,
				initialInput: '/docs',
				interactive: false,
				onWarn: () => {},
			}),
		).rejects.toThrow(/full URL/);
	});

	it('rejects a prefix that matches no inner page', async () => {
		countPageListRows.mockImplementation(
			(_accessor: ArchiveAccessor, options?: { directories?: string[] }) => {
				if (!options?.directories) {
					return Promise.resolve(10_001);
				}
				return Promise.resolve(0);
			},
		);
		countPageListHostnames.mockResolvedValue(1);

		await expect(
			resolveDirectoryPrefixes({
				accessor,
				initialInput: '/missing',
				interactive: false,
				onWarn: () => {},
			}),
		).rejects.toThrow(/No inner page matches/);
	});

	it('rejects a selection that still exceeds 10,000 inner pages', async () => {
		countPageListRows.mockResolvedValue(10_001);
		countPageListHostnames.mockResolvedValue(1);

		await expect(
			resolveDirectoryPrefixes({
				accessor,
				initialInput: '/docs',
				interactive: false,
				onWarn: () => {},
			}),
		).rejects.toThrow(/10,000 or fewer/);
	});

	it('throws HtmlReportCancelledError when the directory prompt is dismissed', async () => {
		countPageListRows.mockResolvedValue(10_001);
		countPageListHostnames.mockResolvedValue(1);
		vi.mocked(enquirer.prompt).mockRejectedValueOnce(new Error('cancelled'));

		await expect(
			resolveDirectoryPrefixes({
				accessor,
				interactive: true,
				onWarn: () => {},
			}),
		).rejects.toBeInstanceOf(HtmlReportCancelledError);
	});
});
