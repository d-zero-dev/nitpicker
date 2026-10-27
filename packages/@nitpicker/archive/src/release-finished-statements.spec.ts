import { describe, expect, it } from 'vitest';

import { releaseFinishedStatements } from './release-finished-statements.js';

describe('releaseFinishedStatements', () => {
	it('lets a callback already queued with setImmediate run before it resolves', async () => {
		let ran = false;
		setImmediate(() => {
			ran = true;
		});
		await releaseFinishedStatements();
		expect(ran).toBe(true);
	});

	it('resolves on its own, with nothing else queued', async () => {
		await expect(releaseFinishedStatements()).resolves.toBeUndefined();
	});
});
