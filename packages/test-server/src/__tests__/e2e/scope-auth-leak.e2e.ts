import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanup, crawl } from './helpers.js';

const SCOPE_USER = 'scope-user';
const SCOPE_PASS = 'scope-pass';
const SCOPE_AUTH_HEADER = `Basic ${Buffer.from(`${SCOPE_USER}:${SCOPE_PASS}`).toString('base64')}`;
const EMPTY_AUTH_HEADER = `Basic ${Buffer.from(':').toString('base64')}`;

/**
 * Reset the test-server's recorded list of off-scope `Authorization`
 * headers. Used at the start of each test so a previous run's leaks (or
 * lack thereof) don't bleed into the next assertion.
 */
async function resetExternalAuthHeaders(): Promise<void> {
	const response = await fetch('http://localhost:8010/scope-auth-leak/reset', {
		method: 'POST',
	});
	if (!response.ok) {
		throw new Error(`Failed to reset external auth headers (status ${response.status})`);
	}
}

/**
 * Fetch the off-scope endpoint's recorded `Authorization` header list,
 * one entry per request the test-server observed against it. `null` means
 * the request had no `Authorization` header at all.
 * @returns Recorded `Authorization` header values in arrival order.
 */
async function readExternalAuthHeaders(): Promise<(string | null)[]> {
	const response = await fetch('http://localhost:8010/scope-auth-leak/external-headers');
	const json = (await response.json()) as { headers: (string | null)[] };
	return json.headers;
}

describe('Scope credential leak guard — sub-resource Basic auth (E2E)', () => {
	let result: Awaited<ReturnType<typeof crawl>> | null = null;

	beforeEach(async () => {
		await resetExternalAuthHeaders();
	});

	afterEach(async () => {
		if (result) {
			await cleanup(result);
			result = null;
		}
	});

	it('does NOT send scope credentials to off-scope sub-resources that demand Basic auth', async () => {
		// Setup recap (full scenario in scope-auth-leak.ts):
		// - Scope: http://scope-user:scope-pass@localhost:8010/scope-auth-leak/main
		// - Main endpoint requires Basic auth matching scope-user:scope-pass.
		// - HTML embeds <img src="http://127.0.0.1:8010/scope-auth-leak/external-asset.png">
		//   — different hostname (127.0.0.1 vs localhost) so the crawler's
		//   scope map treats it as off-scope even though the port matches.
		// - External endpoint records every Authorization header it sees
		//   and always replies 401 + WWW-Authenticate: Basic.
		//
		// Test invariant: across every request the external endpoint
		// observed, NONE may carry the scope credentials. If any did, an
		// attacker hosting that off-scope sub-resource would harvest the
		// in-scope user:pass — the cross-origin credential leak this
		// helper exists to prevent.

		result = await crawl([
			`http://${SCOPE_USER}:${SCOPE_PASS}@localhost:8010/scope-auth-leak/main`,
		]);

		// Sanity: the main scope-protected page was scraped successfully —
		// proves the helper IS forwarding scope credentials to the in-scope
		// origin (otherwise the test would falsely pass for the trivial
		// "we send no auth anywhere" change).
		const pages = await result.accessor.getPages();
		// `Page.url` is an `ExURL` (URL subclass); compare via its
		// stringified `href` field rather than treating it like a raw
		// string.
		const main = pages.find((p) => p.url.href.includes('/scope-auth-leak/main'));
		expect(main).toBeDefined();
		expect(main!.status).toBe(200);

		// Core assertion: the off-scope endpoint observed at least one
		// request (otherwise the test silently passes for any change that
		// breaks sub-resource fetching), AND none of those requests
		// carried the scope credentials.
		const externalHeaders = await readExternalAuthHeaders();
		expect(externalHeaders.length).toBeGreaterThan(0);

		for (const header of externalHeaders) {
			// `Basic <base64(scope-user:scope-pass)>` is the exact string
			// that would identify a leak. Comparing the full header keeps
			// the assertion precise — a partial match (e.g. just the
			// username) is covered by the substring checks below as
			// defence-in-depth.
			expect(header).not.toBe(SCOPE_AUTH_HEADER);
			if (header !== null) {
				// The credential bytes themselves must not appear anywhere
				// in the observed Authorization header. Catches Digest /
				// NTLM / Negotiate variants the test server might surface
				// if the scheme is ever broadened.
				expect(header).not.toContain(SCOPE_USER);
				expect(header).not.toContain(SCOPE_PASS);
				// Belt-and-suspenders: the only Authorization header we
				// allow the off-scope endpoint to see is the empty-cred
				// fallback (`Basic Og==` — i.e. `Basic <base64(":")>`).
				// `expect(...).toBe(EMPTY_AUTH_HEADER)` would also work
				// here; the OR keeps the test forward-compatible with a
				// future change that opts to send no Authorization header
				// at all instead of an empty one.
				expect([EMPTY_AUTH_HEADER]).toContain(header);
			}
		}
	});
});
