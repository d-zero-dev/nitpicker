import { describe, expect, it } from 'vitest';

import { isPuppeteerFallbackCandidate } from './is-puppeteer-fallback-candidate.js';

describe('isPuppeteerFallbackCandidate', () => {
	it('opts in for HEAD/GET timeout-shaped messages (WAF dropping bare probes)', () => {
		// The motivating cases: middleboxes that swallow HEAD/GET timeouts but
		// permit a real puppeteer navigation. All of these arrive as `timeout`
		// kind from the classifier and MUST trip the fallback.
		expect(isPuppeteerFallbackCandidate('Timeout: https://slow.example.org/path')).toBe(
			true,
		);
		expect(
			isPuppeteerFallbackCandidate(
				'[Retried 3 times] Timeout: https://slow.example.org/path',
			),
		).toBe(true);
		expect(isPuppeteerFallbackCandidate('Navigation timeout of 60000 ms exceeded')).toBe(
			true,
		);
	});

	it('opts in for connection-reset / parse-error (middlebox refusing the cheap shape)', () => {
		// Symptoms of a middlebox that drops bare probes: the server sends a
		// malformed HTTP reply that trips the Node parser, or resets the TCP
		// stream after seeing a HEAD. Both are signals that the cheap-probe
		// path is the problem, not the host being unreachable.
		expect(isPuppeteerFallbackCandidate('read ECONNRESET')).toBe(true);
		expect(isPuppeteerFallbackCandidate('Error: socket hang up')).toBe(true);
		expect(
			isPuppeteerFallbackCandidate('Parse Error: Expected HTTP/, RTSP/ or ICE/'),
		).toBe(true);
		expect(isPuppeteerFallbackCandidate('Unexpected end of stream')).toBe(true);
	});

	it('opts OUT for transport-level timeout (ETIMEDOUT) — the host is unreachable, puppeteer hits the same connect()', () => {
		// `connect ETIMEDOUT` is a TCP-connect-stage failure: the packets
		// never reached the destination. Puppeteer issues the same `connect()`
		// call under Chromium and gets the same answer, so paying the cost of
		// a browser launch for these is wasted. Only middlebox-level timeouts
		// (where the request DID reach the server but the response was
		// dropped) qualify, and those classify as `timeout` via the
		// `NetTimeoutError "Timeout: <url>"` shape.
		expect(isPuppeteerFallbackCandidate('connect ETIMEDOUT 93.184.216.34:443')).toBe(
			false,
		);
		expect(isPuppeteerFallbackCandidate('net::ERR_CONNECTION_TIMED_OUT')).toBe(false);
	});

	it('opts OUT for `unknown` — spinning up a browser for every unclassifiable error is too expensive', () => {
		// Conservative on purpose: `unknown` is the catch-all bucket, so
		// widening the fallback to include it would mean launching Chromium
		// for any worker-level crash, bug, or one-off oddity. The intended
		// remediation when a real WAF pattern lands in `unknown` is to add a
		// matcher to `classifyErrorKind` so it bubbles into `timeout` /
		// `connection-reset` / `parse-error` — not to widen this set.
		expect(isPuppeteerFallbackCandidate('something completely unexpected happened')).toBe(
			false,
		);
		expect(isPuppeteerFallbackCandidate('')).toBe(false);
		expect(isPuppeteerFallbackCandidate('unexpected crash')).toBe(false);
	});

	it('opts OUT for DNS failures — puppeteer hits the same getaddrinfo answer', () => {
		expect(
			isPuppeteerFallbackCandidate('getaddrinfo ENOTFOUND host.example.invalid'),
		).toBe(false);
		expect(isPuppeteerFallbackCandidate('net::ERR_NAME_NOT_RESOLVED')).toBe(false);
	});

	it('opts OUT for PreloadShortCircuitError messages via classifyErrorKind', () => {
		// `PreloadShortCircuitError` synthesises `getaddrinfo ENOTFOUND <host>`
		// so it classifies as `dns`. The exclusion via the kind set means the
		// crawler's catch site does NOT need a separate `instanceof` guard.
		expect(isPuppeteerFallbackCandidate('getaddrinfo ENOTFOUND burned.example.com')).toBe(
			false,
		);
	});

	it('opts OUT for transient DNS / EAI_AGAIN — resolver hiccup, retry-failed handles it', () => {
		expect(
			isPuppeteerFallbackCandidate('Error: getaddrinfo EAI_AGAIN host.example.com'),
		).toBe(false);
	});

	it('opts OUT for TLS failures — Chromium will refuse the same cert', () => {
		expect(isPuppeteerFallbackCandidate('net::ERR_CERT_DATE_INVALID')).toBe(false);
		expect(
			isPuppeteerFallbackCandidate(
				"Hostname/IP does not match certificate's altnames: Host: edge.example.com",
			),
		).toBe(false);
	});

	it('opts OUT for client-blocked (Chromium itself is the rejecting party)', () => {
		expect(
			isPuppeteerFallbackCandidate(
				'net::ERR_BLOCKED_BY_CLIENT at https://ad.example.com/',
			),
		).toBe(false);
	});

	it('opts OUT for ECONNREFUSED (authoritative TCP RST)', () => {
		expect(isPuppeteerFallbackCandidate('connect ECONNREFUSED 127.0.0.1:443')).toBe(
			false,
		);
	});

	it('opts OUT for local-network failures (this machine cannot reach anywhere)', () => {
		expect(isPuppeteerFallbackCandidate('net::ERR_INTERNET_DISCONNECTED')).toBe(false);
		expect(isPuppeteerFallbackCandidate('connect ENETUNREACH 10.0.0.1:443')).toBe(false);
	});

	it('opts OUT for puppeteer protocol / lifecycle races (re-triggering reproduces them)', () => {
		expect(
			isPuppeteerFallbackCandidate('Protocol error (Page.reload): Target closed'),
		).toBe(false);
		expect(isPuppeteerFallbackCandidate('Execution context was destroyed')).toBe(false);
	});
});
