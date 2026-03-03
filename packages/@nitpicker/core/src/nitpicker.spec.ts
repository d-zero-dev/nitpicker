import type { Config } from './types.js';

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

import { loadPluginSettings } from './load-plugin-settings.js';
import { Nitpicker } from './nitpicker.js';

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
