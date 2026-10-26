import { describe, it, expect } from 'vitest';

import { commandUsesNativePool } from './command-uses-native-pool.js';

describe('commandUsesNativePool', () => {
	it.each(['crawl', 'pipeline', 'query', 'viewer', 'viewer-build', 'concat', 'split'])(
		'is true for %s, which reaches the native pool',
		(command) => {
			expect(commandUsesNativePool(command)).toBe(true);
		},
	);

	it.each(['report', 'cache'])('is false for %s, which never reaches it', (command) => {
		expect(commandUsesNativePool(command)).toBe(false);
	});

	it('is false when no command was given', () => {
		expect(commandUsesNativePool()).toBe(false);
	});

	it('is false for a command it does not know', () => {
		expect(commandUsesNativePool('unknown')).toBe(false);
	});
});
