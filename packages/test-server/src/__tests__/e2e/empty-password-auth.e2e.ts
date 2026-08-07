import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

describe('Basic auth with an empty password (E2E)', () => {
	let result: Awaited<ReturnType<typeof crawl>> | null = null;

	afterEach(async () => {
		if (result) {
			await cleanup(result);
			result = null;
		}
	});

	it('authenticates both fetch paths for user:@host entry URLs', async () => {
		// `http://user:@host/` is legal Basic auth with an empty password.
		// The crawler's URL type stores the empty password as null, so this
		// crawl proves the HEAD pre-flight treats "username only" as
		// credentials rather than skipping auth entirely.
		//
		// Both URLs are passed as crawl ENTRY points on purpose: entry URLs
		// keep their parsed `username` field, whereas scope-INHERITED auth is
		// injected from the scope map, which is built from `withoutHash`
		// strings — and `parse-url` (external, `@d-zero/shared`) only
		// reconstructs userinfo into `withoutHash` when username AND password
		// are both present. Username-only credentials therefore never reach
		// the scope map, and link-discovered pages cannot inherit them until
		// that package changes (see the ARCHITECTURE.md entry on userinfo
		// handling).
		result = await crawl([
			`http://emptypass-user:@localhost:${TEST_SERVER_PORT}/empty-password-auth/`,
			`http://emptypass-user:@localhost:${TEST_SERVER_PORT}/empty-password-auth/note.txt`,
		]);

		const pages = await result.accessor.getPages();

		const top = pages.find((p) => p.url.pathname === '/empty-password-auth/');
		expect(top).toBeDefined();
		expect(top!.status).toBe(200);

		// text/plain on purpose: non-HTML content is finalized by the HEAD
		// pre-flight alone (no browser, no `page.authenticate` fallback), so
		// this assertion fails if the HEAD path drops empty-password
		// credentials.
		const note = pages.find((p) => p.url.pathname === '/empty-password-auth/note.txt');
		expect(note).toBeDefined();
		expect(note!.status).toBe(200);
	});
});
