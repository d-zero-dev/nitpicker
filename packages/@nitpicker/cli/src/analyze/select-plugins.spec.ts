import type { Plugin } from '@nitpicker/core';

import { describe, it, expect, vi } from 'vitest';

import { selectPlugins } from './select-plugins.js';

/**
 * Creates a minimal Plugin stub for testing.
 * @param name
 */
function createPlugin(name: string): Plugin {
	return {
		name,
		module: name,
		configFilePath: '',
		settings: {},
	};
}

const plugins: Plugin[] = [
	createPlugin('@nitpicker/analyze-axe'),
	createPlugin('@nitpicker/analyze-lighthouse'),
	createPlugin('@nitpicker/analyze-textlint'),
];

describe('selectPlugins', () => {
	it('returns undefined when --all is specified', async () => {
		const promptPlugins = vi.fn();
		const result = await selectPlugins({
			all: true,
			pluginFlags: [],
			plugins,
			isTTY: true,
			promptPlugins,
		});

		expect(result).toBeUndefined();
		expect(promptPlugins).not.toHaveBeenCalled();
	});

	it('returns undefined when --all is specified even with --plugin flags', async () => {
		const promptPlugins = vi.fn();
		const result = await selectPlugins({
			all: true,
			pluginFlags: ['@nitpicker/analyze-axe'],
			plugins,
			isTTY: true,
			promptPlugins,
		});

		expect(result).toBeUndefined();
		expect(promptPlugins).not.toHaveBeenCalled();
	});

	it('returns filtered names when --plugin is specified', async () => {
		const promptPlugins = vi.fn();
		const result = await selectPlugins({
			all: false,
			pluginFlags: ['@nitpicker/analyze-axe', '@nitpicker/analyze-textlint'],
			plugins,
			isTTY: true,
			promptPlugins,
		});

		expect(result).toEqual(['@nitpicker/analyze-axe', '@nitpicker/analyze-textlint']);
		expect(promptPlugins).not.toHaveBeenCalled();
	});

	it('filters out unknown plugin names from --plugin', async () => {
		const promptPlugins = vi.fn();
		const result = await selectPlugins({
			all: false,
			pluginFlags: ['@nitpicker/analyze-axe', '@nitpicker/analyze-unknown'],
			plugins,
			isTTY: true,
			promptPlugins,
		});

		expect(result).toEqual(['@nitpicker/analyze-axe']);
		expect(promptPlugins).not.toHaveBeenCalled();
	});

	it('returns undefined in non-TTY when no flags are specified', async () => {
		const promptPlugins = vi.fn();
		const result = await selectPlugins({
			all: false,
			pluginFlags: [],
			plugins,
			isTTY: false,
			promptPlugins,
		});

		expect(result).toBeUndefined();
		expect(promptPlugins).not.toHaveBeenCalled();
	});

	it('calls promptPlugins in TTY when no flags are specified', async () => {
		const promptPlugins = vi.fn().mockResolvedValue(['@nitpicker/analyze-axe']);
		const result = await selectPlugins({
			all: false,
			pluginFlags: [],
			plugins,
			isTTY: true,
			promptPlugins,
		});

		expect(result).toEqual(['@nitpicker/analyze-axe']);
		expect(promptPlugins).toHaveBeenCalledOnce();
	});

	it('skips prompt with --plugin even in non-TTY', async () => {
		const promptPlugins = vi.fn();
		const result = await selectPlugins({
			all: false,
			pluginFlags: ['@nitpicker/analyze-lighthouse'],
			plugins,
			isTTY: false,
			promptPlugins,
		});

		expect(result).toEqual(['@nitpicker/analyze-lighthouse']);
		expect(promptPlugins).not.toHaveBeenCalled();
	});

	it('returns empty array when all --plugin values are unknown', async () => {
		const promptPlugins = vi.fn();
		const result = await selectPlugins({
			all: false,
			pluginFlags: ['@nitpicker/analyze-unknown'],
			plugins,
			isTTY: true,
			promptPlugins,
		});

		expect(result).toEqual([]);
		expect(promptPlugins).not.toHaveBeenCalled();
	});
});
