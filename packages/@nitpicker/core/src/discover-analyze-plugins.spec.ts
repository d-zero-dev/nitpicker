import { describe, it, expect } from 'vitest';

import { discoverAnalyzePlugins } from './discover-analyze-plugins.js';

describe('discoverAnalyzePlugins', () => {
	it('returns exactly the standard analyze plugins', () => {
		const plugins = discoverAnalyzePlugins();
		expect(plugins.map((p) => p.name)).toEqual([
			'@nitpicker/analyze-axe',
			'@nitpicker/analyze-markuplint',
			'@nitpicker/analyze-search',
			'@nitpicker/analyze-textlint',
		]);
	});

	it('returns plugins with empty default settings', () => {
		const plugins = discoverAnalyzePlugins();
		for (const plugin of plugins) {
			expect(plugin.module).toBe(plugin.name);
			expect(plugin.configFilePath).toBe('');
			expect(plugin.settings).toEqual({});
		}
	});
});
