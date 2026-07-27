import type { ErrorKind } from './types.js';

import { describe, it, expect } from 'vitest';

import { NETWORK_RELATED_ERROR_KINDS } from './network-related-error-kinds.js';

describe('NETWORK_RELATED_ERROR_KINDS', () => {
	it('includes exactly the network-related kinds', () => {
		const expected: ErrorKind[] = [
			'dns',
			'dns-transient',
			'local-network',
			'connection-timeout',
			'connection-reset',
		];
		expect([...NETWORK_RELATED_ERROR_KINDS].toSorted()).toEqual(expected.toSorted());
	});

	it('excludes every site-specific kind', () => {
		const siteSpecificKinds: ErrorKind[] = [
			'tls',
			'connection-refused',
			'parse-error',
			'client-blocked',
			'timeout',
			'protocol',
			'unknown',
		];
		for (const kind of siteSpecificKinds) {
			expect(NETWORK_RELATED_ERROR_KINDS.has(kind), `must exclude ${kind}`).toBe(false);
		}
	});
});
