import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

const USER = 'char-user';
// Characters outside the RFC 3986 userinfo set — the WHATWG URL parser
// percent-encodes them, so the crawler must decode before authenticating.
const RAW_PASS = 'pa]ss[wo{rd}=';

describe('Basic auth with special characters in the password (E2E)', () => {
	let result: Awaited<ReturnType<typeof crawl>> | null = null;

	afterEach(async () => {
		if (result) {
			await cleanup(result);
			result = null;
		}
	});

	it('authenticates when the URL carries a percent-encoded password', async () => {
		// The server behind /special-char-auth/ only accepts the DECODED
		// literal `char-user:pa]ss[wo{rd}=`. The crawl entry URL carries the
		// password percent-encoded (the only valid way to put these
		// characters in a URL), so both the browser scrape and the HEAD
		// pre-flight must decode the userinfo fields before authenticating.
		result = await crawl([
			`http://${USER}:${encodeURIComponent(RAW_PASS)}@localhost:${TEST_SERVER_PORT}/special-char-auth/`,
		]);

		const pages = await result.accessor.getPages();

		const top = pages.find((p) => p.url.pathname === '/special-char-auth/');
		expect(top).toBeDefined();
		expect(top!.status).toBe(200);

		// The sub page is reached via an in-page anchor, so its credentials
		// come from scope-auth inheritance (`injectScopeAuth`) rather than
		// the entry URL — proving the decode also covers inherited auth.
		const sub = pages.find((p) => p.url.pathname === '/special-char-auth/sub');
		expect(sub).toBeDefined();
		expect(sub!.status).toBe(200);
	});

	it('authenticates when the password is typed raw (parser-normalized) in the URL', async () => {
		// `new URL()` tolerates these characters raw in userinfo and
		// normalizes them to the percent-encoded form — the same string a
		// user pastes into the CLI unencoded. The crawl must behave
		// identically to the pre-encoded variant.
		result = await crawl([
			`http://${USER}:${RAW_PASS}@localhost:${TEST_SERVER_PORT}/special-char-auth/`,
		]);

		const pages = await result.accessor.getPages();

		const top = pages.find((p) => p.url.pathname === '/special-char-auth/');
		expect(top).toBeDefined();
		expect(top!.status).toBe(200);
	});
});
