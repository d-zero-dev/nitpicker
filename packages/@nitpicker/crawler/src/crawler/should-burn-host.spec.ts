import type { ErrorKind } from '../types.js';

import { describe, it, expect } from 'vitest';

import { shouldBurnHost } from './should-burn-host.js';

describe('shouldBurnHost', () => {
	it('burns when the final-attempt error is `dns` and the host has no session-success', () => {
		const result = shouldBurnHost({
			errorKind: 'dns',
			host: 'example.com',
			successfulHosts: new Set<string>(),
		});
		expect(result).toBe(true);
	});

	it('does NOT burn when the host has a session-success even if the final-attempt error is `dns`', () => {
		// This is the cascade guard: a host that responded earlier in this
		// session is treated as transiently DNS-unavailable, not dead.
		const result = shouldBurnHost({
			errorKind: 'dns',
			host: 'example.com',
			successfulHosts: new Set(['example.com']),
		});
		expect(result).toBe(false);
	});

	it('does NOT burn on any non-`dns` error kind without session-success', () => {
		// Burn cache is DNS-specific. Every other kind (including
		// `dns-transient` for EAI_AGAIN/EREFUSED, which is absorbed by the
		// retry layer) has its own handling path; this guard never
		// generalises to them. Enumerating the entire `ErrorKind` union
		// minus `'dns'` here means that adding a new variant to `ErrorKind`
		// without updating this test is a deliberate review moment, not a
		// silent regression.
		const nonDnsKinds = [
			'dns-transient',
			'connection-refused',
			'connection-reset',
			'connection-timeout',
			'tls',
			'local-network',
			'parse-error',
			'client-blocked',
			'redirect-loop',
			'timeout',
			'protocol',
			'unknown',
		] as const satisfies Exclude<ErrorKind, 'dns'>[];
		for (const errorKind of nonDnsKinds) {
			const result = shouldBurnHost({
				errorKind,
				host: 'example.com',
				successfulHosts: new Set<string>(),
			});
			expect(result, `should not burn on errorKind=${errorKind}`).toBe(false);
		}
	});

	it('does NOT burn on any non-`dns` error kind even WITH session-success', () => {
		// Pins the AND semantics: both gates must fail (kind=`dns` AND
		// host-not-in-successful) for a burn. If a future refactor swapped
		// the gates to OR, the "dns + session-success" case would still
		// correctly return false but THIS case (non-dns + session-success)
		// would start returning false-positive burns. So we cover both
		// gates' independence.
		const result = shouldBurnHost({
			errorKind: 'timeout',
			host: 'example.com',
			successfulHosts: new Set(['example.com']),
		});
		expect(result).toBe(false);
	});

	it('uses exact-match (case-sensitive) host comparison against the success set', () => {
		// Both the burn cache and the success set use
		// `url.hostname.toLowerCase()`, so a case mismatch would mean the
		// caller mis-normalised one side. The guard does NOT silently
		// case-fold here — the contract is "both sides already lower-cased".
		const result = shouldBurnHost({
			errorKind: 'dns',
			host: 'Example.com',
			successfulHosts: new Set(['example.com']),
		});
		expect(result).toBe(true);
	});
});
