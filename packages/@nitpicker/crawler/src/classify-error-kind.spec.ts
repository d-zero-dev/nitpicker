import { describe, it, expect } from 'vitest';

import { classifyErrorKind } from './classify-error-kind.js';

describe('classifyErrorKind', () => {
	it('classifies persistent DNS resolution failures (NXDOMAIN) as dns', () => {
		expect(classifyErrorKind('getaddrinfo ENOTFOUND www.example.com')).toBe('dns');
		expect(classifyErrorKind('net::ERR_NAME_NOT_RESOLVED at https://example.com')).toBe(
			'dns',
		);
		expect(classifyErrorKind('net::ERR_NAME_RESOLUTION_FAILED')).toBe('dns');
	});

	it('classifies EAI_AGAIN as dns-transient even when the message also says getaddrinfo', () => {
		// `EAI_AGAIN` always rides with `getaddrinfo`. The matcher order must
		// catch the transient form first, otherwise a local resolver hiccup
		// would land in `dns` and burn the host via the DNS-burned cache.
		expect(classifyErrorKind('Error: getaddrinfo EAI_AGAIN example.com')).toBe(
			'dns-transient',
		);
		expect(classifyErrorKind('getaddrinfo EAI_AGAIN foo.example.com')).toBe(
			'dns-transient',
		);
	});

	it('classifies TLS/certificate failures as tls', () => {
		expect(classifyErrorKind('net::ERR_CERT_DATE_INVALID')).toBe('tls');
		expect(classifyErrorKind('Error: unable to verify the first certificate')).toBe(
			'tls',
		);
		expect(classifyErrorKind('net::ERR_SSL_PROTOCOL_ERROR')).toBe('tls');
	});

	it('classifies Node hostname/altname certificate mismatch as tls', () => {
		// Node's tls layer reports certificate-vs-host mismatches with this
		// exact phrasing; without an explicit matcher it falls through to
		// `unknown` and stops being actionable in the viewer's Errors panel.
		expect(
			classifyErrorKind(
				"[Retried 3 times] Hostname/IP does not match certificate's altnames: Host: edge.example.com",
			),
		).toBe('tls');
		expect(
			classifyErrorKind(
				"certificate's altnames: Host: foo.example.com. is not in the cert",
			),
		).toBe('tls');
	});

	it('does NOT misclassify the word "altnames" appearing in unrelated contexts as tls', () => {
		// Regression guard: the tls matcher used to be `…|altnames/i` (bare
		// word), which matched ANY message containing the substring — including
		// a URL path or 5xx body text mentioning `/altnames/`. tls is in
		// `PERMANENT_ERROR_KINDS`, so a false positive would permanently
		// exclude that page from `--retry-failed`. The pattern is now anchored
		// to `certificate'?s? altnames`, so these messages must fall through
		// to `unknown`.
		expect(
			classifyErrorKind(
				'GET https://api.example.com/altnames/lookup — 500 Internal Server Error',
			),
		).toBe('unknown');
		expect(
			classifyErrorKind('Internal log dump: altnames lookup returned 42 records'),
		).toBe('unknown');
	});

	it('classifies connection-refused as connection-refused', () => {
		expect(classifyErrorKind('connect ECONNREFUSED 127.0.0.1:443')).toBe(
			'connection-refused',
		);
		expect(classifyErrorKind('net::ERR_CONNECTION_REFUSED')).toBe('connection-refused');
	});

	it('classifies connection resets and empty responses as connection-reset', () => {
		expect(classifyErrorKind('read ECONNRESET')).toBe('connection-reset');
		expect(classifyErrorKind('Error: socket hang up')).toBe('connection-reset');
		expect(classifyErrorKind('net::ERR_EMPTY_RESPONSE')).toBe('connection-reset');
	});

	it('classifies transport-level timeouts as connection-timeout (not page timeout)', () => {
		expect(classifyErrorKind('connect ETIMEDOUT 93.184.216.34:443')).toBe(
			'connection-timeout',
		);
		expect(classifyErrorKind('net::ERR_CONNECTION_TIMED_OUT')).toBe('connection-timeout');
	});

	it('classifies puppeteer/page timeouts as timeout', () => {
		expect(
			classifyErrorKind(
				'Scraper.#fetchData: gave up after 3 retries — Race 180,000ms vs Scraper.#fetchData',
			),
		).toBe('timeout');
		expect(classifyErrorKind('Navigation timeout of 60000 ms exceeded')).toBe('timeout');
		expect(
			classifyErrorKind('TimeoutError: waiting failed: timeout 30000ms exceeded'),
		).toBe('timeout');
	});

	it('classifies the NetTimeoutError "Timeout: <url>" form as timeout', () => {
		// The HEAD pre-flight race emits exactly this shape via
		// `NetTimeoutError`. Match by the URL-shaped tail (not just an
		// anchored line start) so the retry-exhaustion wrapper variant —
		// `[Retried N times] Timeout: https://...` that ends up in
		// `crawl_errors` / `error.log` — is captured too. Both forms must
		// land in `timeout` rather than `unknown`.
		expect(classifyErrorKind('Timeout: https://www.example.com/path')).toBe('timeout');
		expect(classifyErrorKind('Timeout: http://slow.example.org/page/')).toBe('timeout');
		expect(
			classifyErrorKind('[Retried 3 times] Timeout: https://www.example.com/press/2023/'),
		).toBe('timeout');
		expect(
			classifyErrorKind(
				'NetTimeoutError: [Retried 3 times] Timeout: http://example.com/x',
			),
		).toBe('timeout');
	});

	it('classifies local-network failures (WiFi / OS sleep / unreachable) as local-network', () => {
		expect(classifyErrorKind('net::ERR_INTERNET_DISCONNECTED')).toBe('local-network');
		expect(classifyErrorKind('net::ERR_NETWORK_CHANGED')).toBe('local-network');
		expect(classifyErrorKind('net::ERR_NETWORK_IO_SUSPENDED')).toBe('local-network');
		expect(classifyErrorKind('net::ERR_ADDRESS_UNREACHABLE')).toBe('local-network');
		expect(classifyErrorKind('connect ENETUNREACH 10.0.0.1:443')).toBe('local-network');
		expect(classifyErrorKind('connect EHOSTUNREACH 192.168.1.1:443')).toBe(
			'local-network',
		);
		expect(classifyErrorKind('write EPIPE')).toBe('local-network');
	});

	it('classifies EREFUSED (DNS resolver refused) as dns-transient', () => {
		// EREFUSED comes from libc getaddrinfo when the DNS resolver explicitly
		// rejects the query — usually a transient resolver-side condition (rate
		// limit, ACL, restart), not a sign the host itself is gone. It lives in
		// dns-transient so the DNS-burned cache does not learn it and so the
		// `getaddrinfo` token in the message doesn't drop it into the
		// persistent `dns` bucket.
		expect(classifyErrorKind('Error: getaddrinfo EREFUSED foo.example.com')).toBe(
			'dns-transient',
		);
	});

	it('classifies Chromium client-side blocks as client-blocked', () => {
		// Per Chromium `net/base/net_error_list.h`: ERR_BLOCKED_BY_CLIENT is
		// documented as "The client chose to block the request." The entire
		// ERR_BLOCKED_* family is a deliberate browser-side rejection (ad
		// heuristics, CSP, CORB / ORB, administrator block lists, …) and is
		// orthogonal to "the server didn't respond" — it must not land in
		// unknown or be conflated with protocol / local-network.
		expect(
			classifyErrorKind('net::ERR_BLOCKED_BY_CLIENT at https://ad.example.com/'),
		).toBe('client-blocked');
		expect(classifyErrorKind('net::ERR_BLOCKED_BY_ADMINISTRATOR')).toBe('client-blocked');
		expect(classifyErrorKind('net::ERR_BLOCKED_BY_RESPONSE')).toBe('client-blocked');
		expect(classifyErrorKind('net::ERR_BLOCKED_BY_CSP')).toBe('client-blocked');
		expect(classifyErrorKind('net::ERR_BLOCKED_BY_ORB')).toBe('client-blocked');
		expect(classifyErrorKind('net::ERR_BLOCKED_BY_FINGERPRINTING_PROTECTION')).toBe(
			'client-blocked',
		);
		expect(classifyErrorKind('net::ERR_CLEARTEXT_NOT_PERMITTED')).toBe('client-blocked');
		expect(classifyErrorKind('net::ERR_NETWORK_ACCESS_REVOKED')).toBe('client-blocked');
	});

	it('classifies HTTP parse failures as parse-error', () => {
		expect(classifyErrorKind('Parse Error: Expected HTTP/, RTSP/ or ICE/')).toBe(
			'parse-error',
		);
		expect(classifyErrorKind('Unexpected end of stream')).toBe('parse-error');
	});

	it('classifies puppeteer protocol/lifecycle failures as protocol', () => {
		expect(
			classifyErrorKind('Protocol error (DOM.describeNode): Cannot find context'),
		).toBe('protocol');
		expect(classifyErrorKind('Execution context was destroyed')).toBe('protocol');
		expect(classifyErrorKind('Protocol error (Page.reload): Target closed')).toBe(
			'protocol',
		);
		expect(classifyErrorKind('Navigating frame was detached')).toBe('protocol');
		expect(classifyErrorKind('The method Page.goto returned null')).toBe('protocol');
	});

	it('falls back to unknown when no matcher applies', () => {
		expect(classifyErrorKind('something completely unexpected happened')).toBe('unknown');
		expect(classifyErrorKind('')).toBe('unknown');
	});

	it('prefers the transport cause over the page-timeout bucket', () => {
		// A message carrying ETIMEDOUT must not be mislabelled as a page timeout.
		expect(classifyErrorKind('net::ERR_CONNECTION_TIMED_OUT, timeout exceeded')).toBe(
			'connection-timeout',
		);
	});
});
