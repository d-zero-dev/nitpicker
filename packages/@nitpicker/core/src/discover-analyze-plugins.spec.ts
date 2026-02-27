import { describe, it, expect } from 'vitest';

import { discoverAnalyzePlugins } from './discover-analyze-plugins.js';

describe('discoverAnalyzePlugins', () => {
	it('returns all standard analyze plugins', () => {
		const plugins = discoverAnalyzePlugins();
		expect(plugins.length).toBeGreaterThanOrEqual(6);
		expect(plugins.map((p) => p.name)).toContain('@nitpicker/analyze-axe');
		expect(plugins.map((p) => p.name)).toContain('@nitpicker/analyze-textlint');
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
