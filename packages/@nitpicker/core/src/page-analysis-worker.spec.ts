import { describe, it, expect, vi, beforeEach } from 'vitest';

import { UrlEventBus } from './url-event-bus.js';

vi.mock('./import-modules.js', () => ({
	importModules: vi.fn(),
}));

const { importModules } = await import('./import-modules.js');
const mockedImportModules = vi.mocked(importModules);

const { parseUrl } = await import('@d-zero/shared/parse-url');

describe('page-analysis-worker', () => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	let workerFn: typeof import('./page-analysis-worker.js').default;

	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import('./page-analysis-worker.js');
		workerFn = mod.default;
	});

	it('returns null when plugin has no eachPage', async () => {
		mockedImportModules.mockResolvedValue([{ label: 'No-op plugin' }]);

		const result = await workerFn(
			{
				plugin: {
					name: 'test-plugin',
					module: 'test-plugin',
					configFilePath: '',
				},
				pages: {
					html: '<html><body>Hello</body></html>',
					url: parseUrl('https://example.com/'),
				},
			},
			new UrlEventBus(),
			0,
			1,
		);

		expect(result).toBeNull();
	});

	it('calls eachPage with correct arguments and returns report', async () => {
		let capturedUrl: unknown;
		let capturedHtml: unknown;
		let capturedNum: unknown;
		let capturedTotal: unknown;
		let hadWindow = false;
		let hadDocument = false;

		const eachPage = vi.fn().mockImplementation((arg: Record<string, unknown>) => {
			// Capture state inside callback before JSDOM cleanup in finally block
			capturedUrl = arg.url;
			capturedHtml = arg.html;
			capturedNum = arg.num;
			capturedTotal = arg.total;
			hadWindow = arg.window != null;
			hadDocument = (arg.window as { document?: unknown } | undefined)?.document != null;
			return {
				page: { title: { value: 'Test' } },
				violations: [{ message: 'test violation', severity: 'error' }],
			};
		});
		mockedImportModules.mockResolvedValue([{ eachPage }]);

		const url = parseUrl('https://example.com/page');
		const html = '<html><body><h1>Hello</h1></body></html>';

		const result = await workerFn(
			{
				plugin: {
					name: 'test-plugin',
					module: 'test-plugin',
					configFilePath: '',
				},
				pages: { html, url },
			},
			new UrlEventBus(),
			3,
			10,
		);

		expect(eachPage).toHaveBeenCalledOnce();
		expect(capturedUrl).toBe(url);
		expect(capturedHtml).toBe(html);
		expect(capturedNum).toBe(3);
		expect(capturedTotal).toBe(10);
		expect(hadWindow).toBe(true);
		expect(hadDocument).toBe(true);

		expect(result).toEqual({
			page: { title: { value: 'Test' } },
			violations: [{ message: 'test violation', severity: 'error' }],
		});
	});

	it('emits url event on UrlEventBus', async () => {
		mockedImportModules.mockResolvedValue([
			{ eachPage: vi.fn().mockResolvedValue(null) },
		]);

		const bus = new UrlEventBus();
		const handler = vi.fn();
		bus.on('url', handler);

		await workerFn(
			{
				plugin: {
					name: 'test-plugin',
					module: 'test-plugin',
					configFilePath: '',
				},
				pages: {
					html: '<html></html>',
					url: parseUrl('https://example.com/test'),
				},
			},
			bus,
			0,
			1,
		);

		expect(handler).toHaveBeenCalledWith('https://example.com/test');
	});

	it('returns null when eachPage returns undefined', async () => {
		mockedImportModules.mockResolvedValue([{ eachPage: vi.fn().mockResolvedValue() }]);

		const result = await workerFn(
			{
				plugin: {
					name: 'test-plugin',
					module: 'test-plugin',
					configFilePath: '',
				},
				pages: {
					html: '<html></html>',
					url: parseUrl('https://example.com/'),
				},
			},
			new UrlEventBus(),
			0,
			1,
		);

		expect(result).toBeNull();
	});

	it('returns null and logs error when eachPage throws', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedImportModules.mockResolvedValue([
			{
				eachPage: vi.fn().mockRejectedValue(new Error('plugin crash')),
			},
		]);

		const result = await workerFn(
			{
				plugin: {
					name: 'broken-plugin',
					module: 'broken-plugin',
					configFilePath: '',
				},
				pages: {
					html: '<html></html>',
					url: parseUrl('https://example.com/'),
				},
			},
			new UrlEventBus(),
			0,
			1,
		);

		expect(result).toBeNull();
		expect(consoleErrorSpy).toHaveBeenCalledWith('[broken-plugin] plugin crash');
		consoleErrorSpy.mockRestore();
	});

	it('cleans up JSDOM globals after eachPage completes', async () => {
		let capturedKeys: string[] = [];
		mockedImportModules.mockResolvedValue([
			{
				eachPage: vi.fn().mockImplementation(() => {
					// Capture some JSDOM-injected globals during execution
					capturedKeys = Object.getOwnPropertyNames(globalThis).filter(
						(k) => k === 'HTMLElement' || k === 'NodeList',
					);
					return null;
				}),
			},
		]);

		await workerFn(
			{
				plugin: {
					name: 'test-plugin',
					module: 'test-plugin',
					configFilePath: '',
				},
				pages: {
					html: '<html><body></body></html>',
					url: parseUrl('https://example.com/'),
				},
			},
			new UrlEventBus(),
			0,
			1,
		);

		// JSDOM globals should be available during eachPage
		expect(capturedKeys.length).toBeGreaterThan(0);

		// But cleaned up after
		const g = globalThis as Record<string, unknown>;
		expect(g['HTMLElement']).toBeUndefined();
		expect(g['NodeList']).toBeUndefined();
	});

	it('cleans up JSDOM globals even when eachPage throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedImportModules.mockResolvedValue([
			{
				eachPage: vi.fn().mockRejectedValue(new Error('crash')),
			},
		]);

		await workerFn(
			{
				plugin: {
					name: 'test-plugin',
					module: 'test-plugin',
					configFilePath: '',
				},
				pages: {
					html: '<html><body></body></html>',
					url: parseUrl('https://example.com/'),
				},
			},
			new UrlEventBus(),
			0,
			1,
		);

		const g = globalThis as Record<string, unknown>;
		expect(g['HTMLElement']).toBeUndefined();
		vi.restoreAllMocks();
	});

	it('provides a JSDOM window with the correct URL', async () => {
		let receivedUrl = '';
		mockedImportModules.mockResolvedValue([
			{
				eachPage: vi
					.fn()
					.mockImplementation(
						({ window }: { window: { location: { href: string } } }) => {
							receivedUrl = window.location.href;
							return null;
						},
					),
			},
		]);

		await workerFn(
			{
				plugin: {
					name: 'test-plugin',
					module: 'test-plugin',
					configFilePath: '',
				},
				pages: {
					html: '<html></html>',
					url: parseUrl('https://example.com/specific-page'),
				},
			},
			new UrlEventBus(),
			0,
			1,
		);

		expect(receivedUrl).toBe('https://example.com/specific-page');
	});
});
