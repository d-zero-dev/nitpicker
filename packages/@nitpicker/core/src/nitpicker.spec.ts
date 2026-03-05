import type { AnalyzePlugin, Config, ReportPage } from './types.js';
import type { ExURL } from '@d-zero/shared/parse-url';
import type { Report } from '@nitpicker/types';

import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('./load-plugin-settings.js', () => ({
	loadPluginSettings: vi.fn(),
}));

vi.mock('./import-modules.js', () => ({
	importModules: vi.fn(() => []),
}));

vi.mock('@nitpicker/crawler', () => ({
	Archive: {
		open: vi.fn(),
	},
}));

vi.mock('./worker/run-in-worker.js', () => ({
	runInWorker: vi.fn(),
}));

vi.mock('@d-zero/shared/cache', () => {
	/** Mock Cache class for testing. */
	class MockCache {
		/** Clears the cache. */
		clear() {
			return Promise.resolve();
		}
		/** Loads a cached value. */
		load() {
			return Promise.resolve(null);
		}
		/** Stores a value. */
		store() {
			return Promise.resolve();
		}
	}
	return { Cache: MockCache };
});

import { importModules } from './import-modules.js';
import { loadPluginSettings } from './load-plugin-settings.js';
import { Nitpicker } from './nitpicker.js';
import { runInWorker } from './worker/run-in-worker.js';

const mockedImportModules = vi.mocked(importModules);
const mockedRunInWorker = vi.mocked(runInWorker);

/**
 * Creates a mock URL object compatible with ExURL.
 * @param href - The URL string.
 */
function mockUrl(href: string) {
	return { href } as ExURL;
}

/**
 * Creates a mock page object for getPagesWithRefs callback.
 * @param url - The URL string.
 * @param html - The HTML content (null means no snapshot).
 */
function createMockPage(url: string, html: string | null = '<html></html>') {
	return {
		url: mockUrl(url),
		isExternal: false,
		getHtml: vi.fn().mockResolvedValue(html),
	};
}

/**
 * Creates a minimal mock Archive for testing Nitpicker methods
 * that do not need real DB access.
 */
function createMockArchive() {
	return {
		filePath: '/tmp/test.nitpicker',
		write: vi.fn().mockResolvedValue(),
		close: vi.fn().mockResolvedValue(),
		getUrl: vi.fn().mockResolvedValue('https://example.com'),
		getPagesWithRefs: vi.fn().mockResolvedValue(),
		setData: vi.fn().mockResolvedValue(),
	} as never;
}

afterEach(() => {
	vi.mocked(loadPluginSettings).mockReset();
	mockedImportModules.mockReset();
	mockedRunInWorker.mockReset();
});

describe('setPluginOverrides', () => {
	it('passes overrides to loadPluginSettings on first getConfig call', async () => {
		const config: Config = { analyze: [] };
		vi.mocked(loadPluginSettings).mockResolvedValue(config);

		const nitpicker = new Nitpicker(createMockArchive());
		nitpicker.setPluginOverrides({ '@nitpicker/analyze-axe': { lang: 'en' } });
		await nitpicker.getConfig();

		expect(loadPluginSettings).toHaveBeenCalledTimes(1);
		expect(loadPluginSettings).toHaveBeenCalledWith(
			{},
			{ '@nitpicker/analyze-axe': { lang: 'en' } },
		);
	});

	it('clears cached config when setPluginOverrides is called after getConfig', async () => {
		const configV1: Config = {
			analyze: [{ name: 'a', module: 'a', configFilePath: '', settings: { lang: 'ja' } }],
		};
		const configV2: Config = {
			analyze: [{ name: 'a', module: 'a', configFilePath: '', settings: { lang: 'en' } }],
		};
		vi.mocked(loadPluginSettings)
			.mockResolvedValueOnce(configV1)
			.mockResolvedValueOnce(configV2);

		const nitpicker = new Nitpicker(createMockArchive());

		const first = await nitpicker.getConfig();
		expect(first).toBe(configV1);
		expect(loadPluginSettings).toHaveBeenCalledTimes(1);

		nitpicker.setPluginOverrides({ '@nitpicker/analyze-axe': { lang: 'en' } });
		const second = await nitpicker.getConfig();
		expect(second).toBe(configV2);
		expect(loadPluginSettings).toHaveBeenCalledTimes(2);
		expect(loadPluginSettings).toHaveBeenLastCalledWith(
			{},
			{ '@nitpicker/analyze-axe': { lang: 'en' } },
		);
	});

	it('caches config and does not reload when getConfig is called twice without setPluginOverrides', async () => {
		const config: Config = { analyze: [] };
		vi.mocked(loadPluginSettings).mockResolvedValue(config);

		const nitpicker = new Nitpicker(createMockArchive());

		const first = await nitpicker.getConfig();
		const second = await nitpicker.getConfig();

		expect(first).toBe(second);
		expect(loadPluginSettings).toHaveBeenCalledTimes(1);
	});

	it('uses empty overrides by default', async () => {
		const config: Config = { analyze: [] };
		vi.mocked(loadPluginSettings).mockResolvedValue(config);

		const nitpicker = new Nitpicker(createMockArchive());
		await nitpicker.getConfig();

		expect(loadPluginSettings).toHaveBeenCalledWith({}, {});
	});
});

describe('analyze', () => {
	/**
	 * Helper to set up a Nitpicker instance with mocked archive and plugins.
	 * @param pages - Mock pages to return from getPagesWithRefs.
	 * @param plugins - Plugin configurations.
	 * @param mods - Analyze plugin modules.
	 */
	function setupAnalyze(
		pages: ReturnType<typeof createMockPage>[],
		plugins: Config['analyze'],
		mods: AnalyzePlugin[],
	) {
		const archive = {
			filePath: '/tmp/test.nitpicker',
			write: vi.fn().mockResolvedValue(),
			close: vi.fn().mockResolvedValue(),
			getUrl: vi.fn().mockResolvedValue('https://example.com'),
			getPagesWithRefs: vi
				.fn()
				.mockImplementation(
					async (
						_limit: number,
						callback: (pages: ReturnType<typeof createMockPage>[]) => Promise<void>,
					) => {
						await callback(pages);
					},
				),
			setData: vi.fn().mockResolvedValue(),
		};
		const config: Config = { analyze: plugins };
		vi.mocked(loadPluginSettings).mockResolvedValue(config);
		mockedImportModules.mockResolvedValue(mods);

		const nitpicker = new Nitpicker(archive as never);
		return { nitpicker, archive };
	}

	it('saves report with data when worker returns valid results', async () => {
		const pages = [createMockPage('https://example.com/')];
		const plugin = {
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '',
		};
		const mod: AnalyzePlugin = {
			headers: { score: 'Score' },
			eachPage: vi.fn(),
		};

		const workerResult: ReportPage<string> = {
			page: { score: { value: 100 } },
			violations: [{ message: 'test', severity: 'error', url: 'https://example.com/' }],
		};
		mockedRunInWorker.mockResolvedValue(workerResult);

		const { nitpicker, archive } = setupAnalyze(pages, [plugin], [mod]);
		await nitpicker.analyze();

		const reportCall = archive.setData.mock.calls.find(
			(call: unknown[]) => call[0] === 'analysis/report',
		);
		expect(reportCall).toBeDefined();
		const report = reportCall![1] as Report;
		expect(Object.keys(report.pageData.data).length).toBeGreaterThan(0);
		expect(report.violations.length).toBe(1);
	});

	it('continues processing when a single worker task throws', async () => {
		const pages = [
			createMockPage('https://example.com/page1'),
			createMockPage('https://example.com/page2'),
		];
		const plugin = {
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '',
		};
		const mod: AnalyzePlugin = {
			headers: { score: 'Score' },
			eachPage: vi.fn(),
		};

		// First page throws, second page returns valid result
		mockedRunInWorker
			.mockRejectedValueOnce(new Error('Worker crashed'))
			.mockResolvedValueOnce({
				page: { score: { value: 50 } },
				violations: [],
			});

		const { nitpicker, archive } = setupAnalyze(pages, [plugin], [mod]);
		// Should not throw
		await nitpicker.analyze();

		// Report should still be saved with data from the second page
		const reportCall = archive.setData.mock.calls.find(
			(call: unknown[]) => call[0] === 'analysis/report',
		);
		expect(reportCall).toBeDefined();
		const report = reportCall![1] as Report;
		expect(report.pageData.data['https://example.com/page2']).toBeDefined();
	});

	it('emits error event when a worker task fails', async () => {
		const pages = [createMockPage('https://example.com/')];
		const plugin = {
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '',
		};
		const mod: AnalyzePlugin = {
			headers: { score: 'Score' },
			eachPage: vi.fn(),
		};

		mockedRunInWorker.mockRejectedValue(new Error('Worker OOM'));

		const { nitpicker } = setupAnalyze(pages, [plugin], [mod]);
		const errorHandler = vi.fn();
		nitpicker.on('error', errorHandler);

		await nitpicker.analyze();

		// Two error events: one for the failed task, one for empty results warning
		expect(errorHandler).toHaveBeenCalledTimes(2);
		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('Worker OOM') }),
		);
		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('Produced no data'),
			}),
		);
	});

	it('emits warning when all page results are empty', async () => {
		const pages = [
			createMockPage('https://example.com/page1'),
			createMockPage('https://example.com/page2'),
		];
		const plugin = {
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '',
		};
		const mod: AnalyzePlugin = {
			headers: { score: 'Score' },
			eachPage: vi.fn(),
		};

		// All pages return null (no data)
		mockedRunInWorker.mockResolvedValue(null);

		const { nitpicker, archive } = setupAnalyze(pages, [plugin], [mod]);
		const errorHandler = vi.fn();
		nitpicker.on('error', errorHandler);

		await nitpicker.analyze();

		// Report should be saved but with empty data
		const reportCall = archive.setData.mock.calls.find(
			(call: unknown[]) => call[0] === 'analysis/report',
		);
		expect(reportCall).toBeDefined();
		const report = reportCall![1] as Report;
		expect(Object.keys(report.pageData.data).length).toBe(0);

		// Warning should be emitted about empty results
		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('@nitpicker/analyze-axe'),
			}),
		);
	});

	it('continues when eachUrl plugin throws', async () => {
		const pages = [
			createMockPage('https://example.com/page1'),
			createMockPage('https://example.com/page2'),
		];
		const plugin = {
			name: '@nitpicker/analyze-search',
			module: '@nitpicker/analyze-search',
			configFilePath: '',
		};
		const mod: AnalyzePlugin = {
			eachUrl: vi
				.fn()
				.mockRejectedValueOnce(new Error('eachUrl crash'))
				.mockResolvedValueOnce({
					page: { found: { value: 3 } },
					violations: [],
				}),
		};

		const { nitpicker, archive } = setupAnalyze(pages, [plugin], [mod]);
		const errorHandler = vi.fn();
		nitpicker.on('error', errorHandler);

		await nitpicker.analyze();

		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('eachUrl crash'),
			}),
		);
		const reportCall = archive.setData.mock.calls.find(
			(call: unknown[]) => call[0] === 'analysis/report',
		);
		expect(reportCall).toBeDefined();
	});

	it('preserves results from other plugins when one plugin fails all pages', async () => {
		const pages = [createMockPage('https://example.com/')];
		const pluginA = {
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '',
		};
		const pluginB = {
			name: '@nitpicker/analyze-markuplint',
			module: '@nitpicker/analyze-markuplint',
			configFilePath: '',
		};
		const modA: AnalyzePlugin = {
			headers: { score: 'Score' },
			eachPage: vi.fn(),
		};
		const modB: AnalyzePlugin = {
			headers: { lint: 'Lint' },
			eachPage: vi.fn(),
		};

		mockedRunInWorker
			.mockRejectedValueOnce(new Error('axe crashed'))
			.mockResolvedValueOnce({
				page: { lint: { value: 'ok' } },
				violations: [],
			});

		const { nitpicker, archive } = setupAnalyze(pages, [pluginA, pluginB], [modA, modB]);
		await nitpicker.analyze();

		const reportCall = archive.setData.mock.calls.find(
			(call: unknown[]) => call[0] === 'analysis/report',
		);
		const report = reportCall![1] as Report;
		expect(report.pageData.data['https://example.com/']).toBeDefined();
	});

	it('handles getHtml throwing without crashing', async () => {
		const brokenPage = createMockPage('https://example.com/broken');
		brokenPage.getHtml = vi.fn().mockRejectedValue(new Error('snapshot read failed'));
		const goodPage = createMockPage('https://example.com/good');

		const plugin = {
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '',
		};
		const mod: AnalyzePlugin = {
			headers: { score: 'Score' },
			eachPage: vi.fn(),
		};

		mockedRunInWorker.mockResolvedValue({
			page: { score: { value: 90 } },
			violations: [],
		});

		const { nitpicker, archive } = setupAnalyze([brokenPage, goodPage], [plugin], [mod]);
		const errorHandler = vi.fn();
		nitpicker.on('error', errorHandler);

		await nitpicker.analyze();

		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('snapshot read failed'),
			}),
		);
		const reportCall = archive.setData.mock.calls.find(
			(call: unknown[]) => call[0] === 'analysis/report',
		);
		const report = reportCall![1] as Report;
		expect(report.pageData.data['https://example.com/good']).toBeDefined();
	});

	it('skips pages with no HTML snapshot without error', async () => {
		const pages = [
			createMockPage('https://example.com/no-html', null),
			createMockPage('https://example.com/has-html'),
		];
		const plugin = {
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '',
		};
		const mod: AnalyzePlugin = {
			headers: { score: 'Score' },
			eachPage: vi.fn(),
		};

		mockedRunInWorker.mockResolvedValue({
			page: { score: { value: 80 } },
			violations: [],
		});

		const { nitpicker, archive } = setupAnalyze(pages, [plugin], [mod]);
		await nitpicker.analyze();

		// runInWorker should only be called once (for the page with HTML)
		expect(mockedRunInWorker).toHaveBeenCalledTimes(1);

		const reportCall = archive.setData.mock.calls.find(
			(call: unknown[]) => call[0] === 'analysis/report',
		);
		const report = reportCall![1] as Report;
		expect(report.pageData.data['https://example.com/has-html']).toBeDefined();
		expect(report.pageData.data['https://example.com/no-html']).toBeUndefined();
	});
});
