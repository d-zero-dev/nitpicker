import { describe, expect, it } from 'vitest';

import NetTimeoutError from './net-timeout-error.js';
import { shouldGetFallbackOnHeadFailure } from './should-get-fallback-on-head-failure.js';

describe('shouldGetFallbackOnHeadFailure', () => {
	it('opts IN for NetTimeoutError — the HEAD race ran out without a server response', () => {
		// The motivating case: HEAD pre-flight timed out at 10s, escalation
		// retry deserves a real 30s/60s attempt. Returning true here keeps
		// the error OUT of `destinationCache`, so the next attempt is live.
		expect(
			shouldGetFallbackOnHeadFailure(new NetTimeoutError('https://slow.example.com/')),
		).toBe(true);
	});

	it('opts IN for parse-error messages — middlebox rewriting/truncating the HEAD reply', () => {
		// `Parse Error: Expected HTTP/` and friends classify as `parse-error`
		// in `classifyErrorKind`. WAF/CDN middleboxes often only trip the
		// parser on HEAD while passing GET cleanly.
		expect(
			shouldGetFallbackOnHeadFailure(
				new Error('Parse Error: Expected HTTP/, RTSP/ or ICE/'),
			),
		).toBe(true);
		expect(shouldGetFallbackOnHeadFailure(new Error('Unexpected end of stream'))).toBe(
			true,
		);
	});

	it('opts IN for connection-reset messages — middlebox closing the HEAD connection mid-response', () => {
		expect(shouldGetFallbackOnHeadFailure(new Error('read ECONNRESET'))).toBe(true);
		expect(shouldGetFallbackOnHeadFailure(new Error('Error: socket hang up'))).toBe(true);
		expect(shouldGetFallbackOnHeadFailure(new Error('net::ERR_EMPTY_RESPONSE'))).toBe(
			true,
		);
	});

	it('opts OUT for DNS failures — the host does not resolve, GET hits the same getaddrinfo', () => {
		expect(
			shouldGetFallbackOnHeadFailure(
				new Error('getaddrinfo ENOTFOUND host.example.invalid'),
			),
		).toBe(false);
		expect(shouldGetFallbackOnHeadFailure(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe(
			false,
		);
	});

	it('opts OUT for TLS failures — the cert is the cert regardless of HTTP method', () => {
		expect(shouldGetFallbackOnHeadFailure(new Error('net::ERR_CERT_DATE_INVALID'))).toBe(
			false,
		);
		expect(
			shouldGetFallbackOnHeadFailure(
				new Error('Error: unable to verify the first certificate'),
			),
		).toBe(false);
	});

	it('opts OUT for ECONNREFUSED — authoritative TCP RST from the listener', () => {
		expect(
			shouldGetFallbackOnHeadFailure(new Error('connect ECONNREFUSED 127.0.0.1:443')),
		).toBe(false);
	});

	it('opts OUT for connection-timeout (TCP connect never reached the host)', () => {
		// `ETIMEDOUT` at TCP connect is distinct from a `NetTimeoutError`
		// (which is the HEAD-race timeout fired AFTER the connect succeeded).
		// The TCP-connect failure indicates the packets never reached the
		// host — GET would hit the same `connect()` call.
		expect(
			shouldGetFallbackOnHeadFailure(new Error('connect ETIMEDOUT 93.184.216.34:443')),
		).toBe(false);
	});

	it('opts OUT for the plain `timeout` kind from puppeteer-side / wrapper errors', () => {
		// The classifier's `timeout` matcher catches things like
		// "Navigation timeout of 60000 ms exceeded" — these come from
		// puppeteer or beholder, not the HEAD race itself. GET fallback +
		// cache-skip do not apply.
		expect(
			shouldGetFallbackOnHeadFailure(
				new Error('Navigation timeout of 60000 ms exceeded'),
			),
		).toBe(false);
	});

	it('opts OUT for client-blocked (Chromium-side refusal, not server response)', () => {
		expect(
			shouldGetFallbackOnHeadFailure(
				new Error('net::ERR_BLOCKED_BY_CLIENT at https://ad.example.com/'),
			),
		).toBe(false);
	});

	it('opts OUT for redirect-loop — a GET hits the same never-terminating chain', () => {
		expect(
			shouldGetFallbackOnHeadFailure(new Error('Maximum number of redirects exceeded')),
		).toBe(false);
	});

	it('opts OUT for unknown — without a positive signal we keep the cached verdict to avoid pointless retries', () => {
		expect(
			shouldGetFallbackOnHeadFailure(new Error('something completely unexpected')),
		).toBe(false);
		expect(shouldGetFallbackOnHeadFailure(new Error('(empty)'))).toBe(false);
	});
});
