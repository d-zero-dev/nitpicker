import { cosmiconfig } from 'cosmiconfig';
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('cosmiconfig', () => ({
	cosmiconfig: vi.fn(),
}));

vi.mock('./discover-analyze-plugins.js', () => ({
	discoverAnalyzePlugins: vi.fn(() => []),
}));

import { discoverAnalyzePlugins } from './discover-analyze-plugins.js';
import { loadPluginSettings } from './load-plugin-settings.js';

afterEach(() => {
	vi.mocked(discoverAnalyzePlugins).mockClear();
});

/**
 * Set up the cosmiconfig mock to return a specific search result.
 * @param result - The mock cosmiconfig search result, or null for no config found.
 */
function mockCosmiconfig(
	result: { config: unknown; filepath: string; isEmpty?: boolean } | null,
) {
	vi.mocked(cosmiconfig).mockReturnValue({
		search: vi.fn().mockResolvedValue(result),
	} as never);
}

describe('loadPluginSettings', () => {
	it('returns empty analyze array when no config found', async () => {
		mockCosmiconfig(null);
		const config = await loadPluginSettings();
		expect(config.analyze).toEqual([]);
	});

	it('returns empty analyze array when config is empty', async () => {
		mockCosmiconfig({ config: null, filepath: '/path/.nitpickerrc.json', isEmpty: true });
		const config = await loadPluginSettings();
		expect(config.analyze).toEqual([]);
	});

	it('returns empty analyze array when config has no plugins', async () => {
		mockCosmiconfig({ config: {}, filepath: '/path/.nitpickerrc.json' });
		const config = await loadPluginSettings();
		expect(config.analyze).toEqual([]);
	});

	it('converts plugins.analyze object to Plugin array', async () => {
		mockCosmiconfig({
			config: {
				plugins: {
					analyze: {
						'@nitpicker/analyze-axe': { lang: 'ja' },
					},
				},
			},
			filepath: '/path/.nitpickerrc.json',
		});
		const config = await loadPluginSettings();
		expect(config.analyze).toHaveLength(1);
		expect(config.analyze[0]).toEqual({
			name: '@nitpicker/analyze-axe',
			module: '@nitpicker/analyze-axe',
			configFilePath: '/path/.nitpickerrc.json',
			settings: { lang: 'ja' },
		});
	});

	it('normalizes boolean true settings to empty object', async () => {
		mockCosmiconfig({
			config: {
				plugins: {
					analyze: {
						'@nitpicker/analyze-markuplint': true,
					},
				},
			},
			filepath: '/path/.nitpickerrc.json',
		});
		const config = await loadPluginSettings();
		expect(config.analyze[0].settings).toEqual({});
	});

	it('skips falsy plugin entries', async () => {
		mockCosmiconfig({
			config: {
				plugins: {
					analyze: {
						'@nitpicker/analyze-axe': { lang: 'ja' },
						'@nitpicker/analyze-disabled': false,
					},
				},
			},
			filepath: '/path/.nitpickerrc.json',
		});
		const config = await loadPluginSettings();
		expect(config.analyze).toHaveLength(1);
		expect(config.analyze[0].name).toBe('@nitpicker/analyze-axe');
	});

	it('merges defaultConfig analyze plugins before discovered plugins', async () => {
		mockCosmiconfig({
			config: {
				plugins: {
					analyze: {
						'@nitpicker/analyze-axe': true,
					},
				},
			},
			filepath: '/path/.nitpickerrc.json',
		});
		const defaultPlugin = {
			name: 'default-plugin',
			module: 'default-plugin',
			configFilePath: '/default',
			settings: {},
		};
		const config = await loadPluginSettings({ analyze: [defaultPlugin] });
		expect(config.analyze).toHaveLength(2);
		expect(config.analyze[0].name).toBe('default-plugin');
		expect(config.analyze[1].name).toBe('@nitpicker/analyze-axe');
	});

	it('spreads defaultConfig keys when no config found', async () => {
		mockCosmiconfig(null);
		const config = await loadPluginSettings({ analyze: [] });
		expect(config.analyze).toEqual([]);
	});

	it('falls back to discoverAnalyzePlugins when no config found and no defaults', async () => {
		const discovered = [
			{
				name: '@nitpicker/analyze-axe',
				module: '@nitpicker/analyze-axe',
				configFilePath: '',
				settings: {},
			},
		];
		vi.mocked(discoverAnalyzePlugins).mockReturnValue(discovered);
		mockCosmiconfig(null);
		const config = await loadPluginSettings();
		expect(config.analyze).toEqual(discovered);
	});

	it('falls back to discoverAnalyzePlugins when config is empty', async () => {
		const discovered = [
			{
				name: '@nitpicker/analyze-markuplint',
				module: '@nitpicker/analyze-markuplint',
				configFilePath: '',
				settings: {},
			},
		];
		vi.mocked(discoverAnalyzePlugins).mockReturnValue(discovered);
		mockCosmiconfig({ config: null, filepath: '/path/.nitpickerrc.json', isEmpty: true });
		const config = await loadPluginSettings();
		expect(config.analyze).toEqual(discovered);
	});

	it('falls back to discoverAnalyzePlugins when config has no plugins section', async () => {
		const discovered = [
			{
				name: '@nitpicker/analyze-axe',
				module: '@nitpicker/analyze-axe',
				configFilePath: '',
				settings: {},
			},
		];
		vi.mocked(discoverAnalyzePlugins).mockReturnValue(discovered);
		mockCosmiconfig({ config: {}, filepath: '/path/.nitpickerrc.json' });
		const config = await loadPluginSettings();
		expect(config.analyze).toEqual(discovered);
	});

	it('does not fall back when config has plugins', async () => {
		mockCosmiconfig({
			config: {
				plugins: {
					analyze: {
						'@nitpicker/analyze-axe': { lang: 'ja' },
					},
				},
			},
			filepath: '/path/.nitpickerrc.json',
		});
		const config = await loadPluginSettings();
		expect(discoverAnalyzePlugins).not.toHaveBeenCalled();
		expect(config.analyze).toHaveLength(1);
	});
});
