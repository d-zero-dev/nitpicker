import type { AnalyzePlugin, Plugin } from './types.js';

import { describe, it, expect, vi } from 'vitest';

vi.mock('./import-modules.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('./import-modules.js')>(); // eslint-disable-line @typescript-eslint/consistent-type-imports
	return { importModules: original.importModules };
});

describe('importModules', () => {
	it('imports and initializes a single plugin', async () => {
		const mockPlugin: AnalyzePlugin = {
			label: 'Test Plugin',
			headers: { col: 'Column' },
		};
		const factory = vi.fn().mockReturnValue(mockPlugin);

		vi.doMock('@nitpicker/analyze-fake-a', () => ({ default: factory }));

		const { importModules } = await import('./import-modules.js');

		const plugins: Plugin[] = [
			{
				name: '@nitpicker/analyze-fake-a',
				module: '@nitpicker/analyze-fake-a',
				configFilePath: '/path/to/config',
				settings: { lang: 'ja' },
			},
		];

		const result = await importModules(plugins);

		expect(result).toHaveLength(1);
		expect(result[0]).toBe(mockPlugin);
		expect(factory).toHaveBeenCalledWith({ lang: 'ja' });
	});

	it('imports multiple plugins in parallel', async () => {
		const pluginA: AnalyzePlugin = { label: 'A' };
		const pluginB: AnalyzePlugin = { label: 'B' };
		const factoryA = vi.fn().mockReturnValue(pluginA);
		const factoryB = vi.fn().mockReturnValue(pluginB);

		vi.doMock('@nitpicker/analyze-fake-b1', () => ({ default: factoryA }));
		vi.doMock('@nitpicker/analyze-fake-b2', () => ({ default: factoryB }));

		const { importModules } = await import('./import-modules.js');

		const plugins: Plugin[] = [
			{
				name: '@nitpicker/analyze-fake-b1',
				module: '@nitpicker/analyze-fake-b1',
				configFilePath: '',
			},
			{
				name: '@nitpicker/analyze-fake-b2',
				module: '@nitpicker/analyze-fake-b2',
				configFilePath: '',
			},
		];

		const result = await importModules(plugins);

		expect(result).toHaveLength(2);
		expect(result[0]).toBe(pluginA);
		expect(result[1]).toBe(pluginB);
	});

	it('passes undefined settings when not configured', async () => {
		const factory = vi.fn().mockReturnValue({});

		vi.doMock('@nitpicker/analyze-fake-c', () => ({ default: factory }));

		const { importModules } = await import('./import-modules.js');

		const plugins: Plugin[] = [
			{
				name: '@nitpicker/analyze-fake-c',
				module: '@nitpicker/analyze-fake-c',
				configFilePath: '',
			},
		];

		await importModules(plugins);

		expect(factory).toHaveBeenCalledWith(undefined);
	});

	it('handles async factory functions', async () => {
		const pluginResult: AnalyzePlugin = {
			label: 'Async Plugin',
			headers: { score: 'Score' },
		};
		const factory = vi.fn().mockResolvedValue(pluginResult);

		vi.doMock('@nitpicker/analyze-fake-d', () => ({ default: factory }));

		const { importModules } = await import('./import-modules.js');

		const plugins: Plugin[] = [
			{
				name: '@nitpicker/analyze-fake-d',
				module: '@nitpicker/analyze-fake-d',
				configFilePath: '',
				settings: {},
			},
		];

		const result = await importModules(plugins);

		expect(result[0]).toBe(pluginResult);
	});

	it('returns empty array for empty plugin list', async () => {
		const { importModules } = await import('./import-modules.js');
		const result = await importModules([]);

		expect(result).toEqual([]);
	});

	it('rejects plugin modules without the @nitpicker/analyze- prefix', async () => {
		const { importModules } = await import('./import-modules.js');

		const plugins: Plugin[] = [
			{
				name: 'malicious-plugin',
				module: 'malicious-plugin',
				configFilePath: '',
			},
		];

		await expect(importModules(plugins)).rejects.toThrow(
			'Unauthorized plugin module: "malicious-plugin". Plugin modules must start with "@nitpicker/analyze-".',
		);
	});

	it('rejects plugin modules with a similar but incorrect prefix', async () => {
		const { importModules } = await import('./import-modules.js');

		const plugins: Plugin[] = [
			{
				name: 'tricky-plugin',
				module: '@nitpicker/analyze',
				configFilePath: '',
			},
		];

		await expect(importModules(plugins)).rejects.toThrow('Unauthorized plugin module');
	});
});
