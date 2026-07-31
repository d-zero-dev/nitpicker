import { describe, expect, it } from 'vitest';

import { classifyErrorKind } from './classify-error-kind.js';
import { PERMANENT_ERROR_KINDS } from './permanent-error-kinds.js';

describe('PERMANENT_ERROR_KINDS', () => {
	it('contains exactly the six persistent kinds — guards against accidental drift', () => {
		// Pinning the membership prevents silent additions; widening this set
		// changes `resetFailedPages` behavior across every Nitpicker user, so a
		// reviewer should explicitly re-evaluate the docstring rationale when
		// this test fails.
		expect([...PERMANENT_ERROR_KINDS].toSorted()).toEqual([
			'client-blocked',
			'connection-refused',
			'dns',
			'parse-error',
			'redirect-loop',
			'tls',
		]);
	});

	it('marks the canonical persistent-failure messages as permanent', () => {
		// Every entry here must produce a kind that the set considers permanent.
		// Using `classifyErrorKind` end-to-end (not hard-coded kinds) catches the
		// regression where the classifier and the permanent-kind set drift apart
		// — the two together form the retry-exclusion contract.
		const persistentMessages = [
			'getaddrinfo ENOTFOUND host.example.invalid',
			'net::ERR_NAME_NOT_RESOLVED',
			'net::ERR_CERT_DATE_INVALID',
			"Hostname/IP does not match certificate's altnames: Host: edge.example.com",
			'net::ERR_BLOCKED_BY_CLIENT at https://ad.example.com/',
			'Parse Error: Expected HTTP/, RTSP/ or ICE/',
			'connect ECONNREFUSED 127.0.0.1:443',
			'Maximum number of redirects exceeded',
		] as const;
		for (const message of persistentMessages) {
			expect(PERMANENT_ERROR_KINDS.has(classifyErrorKind(message))).toBe(true);
		}
	});

	it('keeps transient / situational kinds OUT of the permanent set', () => {
		// These are the kinds that MUST stay retryable: each represents either a
		// transient condition (resolver hiccup, middlebox blip, slow server) or
		// an operator-side condition (local network loss, puppeteer lifecycle
		// race, unknown) where a fresh attempt has real signal value.
		const retryableMessages = [
			'Error: getaddrinfo EAI_AGAIN example.com', // dns-transient
			'Error: getaddrinfo EREFUSED example.com', // dns-transient
			'read ECONNRESET', // connection-reset
			'connect ETIMEDOUT 93.184.216.34:443', // connection-timeout
			'net::ERR_INTERNET_DISCONNECTED', // local-network
			'Timeout: https://slow.example.org/', // timeout
			'Navigation timeout of 60000 ms exceeded', // timeout
			'Protocol error (Page.reload): Target closed', // protocol
			'something completely unexpected happened', // unknown
		] as const;
		for (const message of retryableMessages) {
			expect(PERMANENT_ERROR_KINDS.has(classifyErrorKind(message))).toBe(false);
		}
	});
});
