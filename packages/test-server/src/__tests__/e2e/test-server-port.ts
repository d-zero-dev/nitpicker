import { inject } from 'vitest';

// This `ProvidedContext` shape is duplicated in
// `packages/@nitpicker/report-google-sheets/src/__tests__/api/create-sheets.api.ts`
// (a separate TS project — that package has no reference to this one) — keep
// both declarations in sync if `testServerPort`'s shape ever changes.
declare module 'vitest' {
	interface ProvidedContext {
		testServerPort: number;
	}
}

/**
 * The E2E test server's actual listening port.
 *
 * The server binds to an OS-assigned port instead of a fixed one so that
 * concurrent worktrees/sessions never collide on `EADDRINUSE` (#162);
 * `global-setup.ts` shares the resolved port with test files through this
 * value via vitest's provide/inject channel.
 */
export const TEST_SERVER_PORT = inject('testServerPort');

/**
 * Origin of the E2E test server (`http://localhost:<port>`, no trailing
 * slash) — the shape every test file needs for its in-scope crawl targets.
 */
export const TEST_SERVER_ORIGIN = `http://localhost:${TEST_SERVER_PORT}`;

/**
 * Origin of the E2E test server addressed via `127.0.0.1` instead of
 * `localhost` — used deliberately by scope/exclude tests to simulate an
 * "external" host on the same server (the crawler's scope map is keyed on
 * hostname, so this hostname alone makes a URL look off-scope).
 */
export const TEST_SERVER_EXTERNAL_ORIGIN = `http://127.0.0.1:${TEST_SERVER_PORT}`;
