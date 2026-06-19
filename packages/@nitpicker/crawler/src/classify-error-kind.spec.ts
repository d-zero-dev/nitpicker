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

	it('classifies the bare "certificate has expired" Node tls message as tls', () => {
		// Real-world archive observation: multiple distinct pages on one
		// site surfaced `[Retried 3 times] certificate has expired` (no
		// ERR_CERT prefix, no Chromium error code) and fell through to
		// `unknown`, which then left them out of the tls bucket on the
		// Errors view and exempt from the `PERMANENT_ERROR_KINDS`
		// `--retry-failed` exclusion. Node's tls layer emits exactly this
		// phrase when the peer cert's `notAfter` is past, so anchoring on
		// it pulls those rows back into tls.
		expect(classifyErrorKind('certificate has expired')).toBe('tls');
		expect(classifyErrorKind('[Retried 3 times] certificate has expired')).toBe('tls');
	});

	it('does NOT classify a body containing "certificate has expired" mid-string as tls', () => {
		// Regression guard: the tls token is end-anchored (`\s*$`) so a
		// WAF / upstream-leaked 5xx body that happens to echo the phrase
		// in the MIDDLE of an error message does NOT misclassify as `tls`
		// — `tls ∈ PERMANENT_ERROR_KINDS`, so a false positive would
		// permanently exclude that page from `--retry-failed`.
		// Representative shapes the regex must reject — application-layer
		// error bodies that could legitimately echo the phrase but are NOT
		// TLS errors (synthetic inputs, not historical archive
		// observations):
		expect(
			classifyErrorKind(
				'Error: License certificate has expired (LICENSE_EXPIRED) — please renew',
			),
		).toBe('unknown');
		expect(
			classifyErrorKind(
				'JWT signing certificate has expired at 2026-01-01 — rotate the signing key',
			),
		).toBe('unknown');
		expect(classifyErrorKind('Application certificate has expired, contact admin')).toBe(
			'unknown',
		);
	});

	it('accepts trailing whitespace after "certificate has expired" (the `\\s*$` bound)', () => {
		// The end-anchor uses `\s*$` rather than `$` so a message that
		// arrives with stray trailing whitespace (space / tab / newline)
		// still classifies. Without this allowance, a retry wrapper that
		// pads its message with a newline could silently drop the
		// expired-cert page out of the tls bucket. Pin all three common
		// trailing-whitespace shapes so a future tightening of `\s*` to
		// `$` would break this test instead of silently regressing.
		expect(classifyErrorKind('certificate has expired ')).toBe('tls');
		expect(classifyErrorKind('certificate has expired\t')).toBe('tls');
		expect(classifyErrorKind('certificate has expired\n')).toBe('tls');
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

	it('classifies any "Page.<method> returned" puppeteer wrapper as protocol (the `\\w+` wildcard)', () => {
		// The matcher uses `Page\.\w+ returned` (not just `Page.goto`) so
		// other puppeteer Page-domain methods that surface the same
		// "returned <something>" shape land in protocol consistently. The
		// production observation that prompted this was `Page.goto` only,
		// but the regex's `\w+` is the intended generalization — pin it so
		// a future tightening to a literal method name has to update this
		// test, not silently degrade coverage for the broader contract.
		expect(classifyErrorKind('The method Page.reload returned null')).toBe('protocol');
		expect(classifyErrorKind('The method Page.evaluate returned undefined')).toBe(
			'protocol',
		);
		expect(classifyErrorKind('Page.close returned an unexpected value')).toBe('protocol');
	});

	it('classifies puppeteer "Attempted to use detached Frame" symptom as protocol', () => {
		// Puppeteer's current Frame.ts surfaces frame-detach symptoms as
		// `Attempted to use detached Frame '<frame-id>'.` — the word order
		// is `detached Frame`, not `frame ... detached`. The matcher used
		// to require the latter and miss every instance of the former,
		// quietly routing them to `unknown` (observed on a real archive
		// with multiple distinct frame IDs).
		expect(
			classifyErrorKind(
				"[Retried 3 times] Attempted to use detached Frame 'F80D11D75F28561E62F453DB933EC08D'.",
			),
		).toBe('protocol');
		expect(classifyErrorKind('Attempted to use detached Frame: x')).toBe('protocol');
	});

	it('matches the puppeteer prefix case-insensitively (detached frame / detached Frame)', () => {
		// The classifier uses the `i` flag so `frame (case-insensitive)` is just one of
		// several casing variants Chromium may surface. Pin both
		// orientations so a future regex tightening that drops the case
		// flag does not silently shut off either path.
		expect(classifyErrorKind('Attempted to use detached frame X')).toBe('protocol');
		expect(classifyErrorKind('attempted to use detached Frame X')).toBe('protocol');
	});

	it('does NOT classify unrelated diagnostics that mention "detached frame" as protocol', () => {
		// The puppeteer prefix `Attempted to use detached frame (case-insensitive)` is the
		// only puppeteer-originating shape. Console / logger / Sentry-style
		// messages that mention the same two tokens in unrelated context
		// (`detached Frame ref leaked at app.js:1234`, etc.) MUST fall
		// through to `unknown`. Without the prefix anchor those would land
		// in `protocol` and inflate the Errors view's `protocol` bucket.
		expect(classifyErrorKind('Console: detached Frame ref leaked at app.js:1234')).toBe(
			'unknown',
		);
		expect(
			classifyErrorKind('TypeError: detached frame property access on null receiver'),
		).toBe('unknown');
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
