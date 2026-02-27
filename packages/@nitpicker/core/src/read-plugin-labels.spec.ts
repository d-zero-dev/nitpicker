import type { Plugin } from './types.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('readPluginLabels', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('reads labels from plugins', async () => {
		vi.doMock('label-plugin-a', () => ({
			default: () => ({ label: 'axe: アクセシビリティチェック' }),
		}));

		const { readPluginLabels } = await import('./read-plugin-labels.js');

		const plugins: Plugin[] = [
			{
				name: '@nitpicker/analyze-axe',
				module: 'label-plugin-a',
				configFilePath: '/config',
			},
		];

		const labels = await readPluginLabels(plugins);

		expect(labels.get('@nitpicker/analyze-axe')).toBe('axe: アクセシビリティチェック');
	});

	it('reads labels from multiple plugins', async () => {
		vi.doMock('label-plugin-b1', () => ({
			default: () => ({ label: 'Plugin B1' }),
		}));
		vi.doMock('label-plugin-b2', () => ({
			default: () => ({ label: 'Plugin B2' }),
		}));

		const { readPluginLabels } = await import('./read-plugin-labels.js');

		const plugins: Plugin[] = [
			{ name: 'b1', module: 'label-plugin-b1', configFilePath: '' },
			{ name: 'b2', module: 'label-plugin-b2', configFilePath: '' },
		];

		const labels = await readPluginLabels(plugins);

		expect(labels.size).toBe(2);
		expect(labels.get('b1')).toBe('Plugin B1');
		expect(labels.get('b2')).toBe('Plugin B2');
	});

	it('skips plugins that lack a label', async () => {
		vi.doMock('label-plugin-c', () => ({
			default: () => ({ headers: { col: 'Column' } }),
		}));

		const { readPluginLabels } = await import('./read-plugin-labels.js');

		const plugins: Plugin[] = [
			{ name: 'no-label', module: 'label-plugin-c', configFilePath: '' },
		];

		const labels = await readPluginLabels(plugins);

		expect(labels.size).toBe(0);
	});

	it('skips plugins whose import fails', async () => {
		vi.doMock('label-plugin-broken', () => {
			throw new Error('module not found');
		});

		const { readPluginLabels } = await import('./read-plugin-labels.js');

		const plugins: Plugin[] = [
			{ name: 'broken', module: 'label-plugin-broken', configFilePath: '' },
		];

		const labels = await readPluginLabels(plugins);

		expect(labels.size).toBe(0);
	});

	it('skips plugins whose factory throws', async () => {
		vi.doMock('label-plugin-throw', () => ({
			default: () => {
				throw new Error('factory error');
			},
		}));

		const { readPluginLabels } = await import('./read-plugin-labels.js');

		const plugins: Plugin[] = [
			{ name: 'throw', module: 'label-plugin-throw', configFilePath: '' },
		];

		const labels = await readPluginLabels(plugins);

		expect(labels.size).toBe(0);
	});

	it('passes settings and configFilePath to factory', async () => {
		const factory = vi.fn().mockReturnValue({ label: 'Configured' });
		vi.doMock('label-plugin-d', () => ({ default: factory }));

		const { readPluginLabels } = await import('./read-plugin-labels.js');

		const plugins: Plugin[] = [
			{
				name: 'configured',
				module: 'label-plugin-d',
				configFilePath: '/path/to/.nitpickerrc',
				settings: { lang: 'ja' },
			},
		];

		await readPluginLabels(plugins);

		expect(factory).toHaveBeenCalledWith({ lang: 'ja' }, '/path/to/.nitpickerrc');
	});

	it('returns empty map for empty plugin list', async () => {
		const { readPluginLabels } = await import('./read-plugin-labels.js');
		const labels = await readPluginLabels([]);

		expect(labels.size).toBe(0);
	});

	it('collects labels from working plugins even when some fail', async () => {
		vi.doMock('label-plugin-good', () => ({
			default: () => ({ label: 'Good Plugin' }),
		}));
		vi.doMock('label-plugin-bad', () => ({
			default: () => {
				throw new Error('bad');
			},
		}));

		const { readPluginLabels } = await import('./read-plugin-labels.js');

		const plugins: Plugin[] = [
			{ name: 'good', module: 'label-plugin-good', configFilePath: '' },
			{ name: 'bad', module: 'label-plugin-bad', configFilePath: '' },
		];

		const labels = await readPluginLabels(plugins);

		expect(labels.size).toBe(1);
		expect(labels.get('good')).toBe('Good Plugin');
	});
});
