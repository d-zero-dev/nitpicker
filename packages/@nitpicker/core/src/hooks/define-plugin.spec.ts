import type { PluginFactory } from '../types.js';

import { describe, it, expect } from 'vitest';

import { definePlugin } from './define-plugin.js';

describe('definePlugin', () => {
	it('returns the exact same function passed in', () => {
		const factory: PluginFactory<{ lang: string }> = (options) => {
			return {
				headers: { score: `Score (${options.lang})` },
			};
		};

		const result = definePlugin(factory);

		expect(result).toBe(factory);
	});

	it('preserves type inference for sync factories', () => {
		const factory = definePlugin((() => ({
			headers: { found: 'Found' },
		})) as PluginFactory<{ keywords: string[] }>);

		expect(typeof factory).toBe('function');
	});

	it('preserves label in the returned AnalyzePlugin', () => {
		const factory = definePlugin((() => ({
			label: 'テスト用プラグイン',
			headers: { score: 'Score' },
		})) as PluginFactory<Record<string, never>>);

		const plugin = factory({} as never, '');

		expect(plugin).toHaveProperty('label', 'テスト用プラグイン');
	});
});
