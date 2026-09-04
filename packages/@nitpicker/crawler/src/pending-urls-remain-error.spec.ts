import { describe, expect, it } from 'vitest';

import { PendingUrlsRemainError } from './pending-urls-remain-error.js';

describe('PendingUrlsRemainError', () => {
	it('carries all fields as readonly properties', () => {
		const error = new PendingUrlsRemainError({
			pendingCount: 128,
			attemptsMade: 3,
			maxAutoRetry: 3,
			reason: 'exhausted',
			stubPath: '/tmp/._nitpicker-example',
		});

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('PendingUrlsRemainError');
		expect(error.pendingCount).toBe(128);
		expect(error.attemptsMade).toBe(3);
		expect(error.maxAutoRetry).toBe(3);
		expect(error.reason).toBe('exhausted');
		expect(error.stubPath).toBe('/tmp/._nitpicker-example');
	});

	it('mentions the stub path and pending count for the "exhausted" reason', () => {
		const error = new PendingUrlsRemainError({
			pendingCount: 10,
			attemptsMade: 3,
			maxAutoRetry: 3,
			reason: 'exhausted',
			stubPath: '/tmp/._nitpicker-example',
		});

		expect(error.message).toContain('10 page(s)');
		expect(error.message).toContain('/tmp/._nitpicker-example');
		expect(error.message).toContain('exhausted');
	});

	it('explains the no-progress reason distinctly from exhaustion', () => {
		const error = new PendingUrlsRemainError({
			pendingCount: 50,
			attemptsMade: 1,
			maxAutoRetry: 3,
			reason: 'no-progress',
			stubPath: '/tmp/._nitpicker-example',
		});

		expect(error.message).toContain('no progress');
		expect(error.message).not.toContain('exhausted');
	});
});
