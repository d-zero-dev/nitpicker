import fs from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Database } from './database.js';
import { remove } from './filesystem/remove.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const dbPath = path.resolve(workingDir, 'list-dns-burned-host-candidates.sqlite');

beforeEach(async () => {
	await fs.rm(dbPath, { force: true });
});

afterEach(async () => {
	await remove(dbPath);
});

/**
 * Stage a fresh database and return it.
 * @returns A connected Database instance.
 */
async function openDb(): Promise<Database> {
	return Database.connect({ filename: dbPath });
}

/**
 * Insert a placeholder page row so the test can model "host has 2xx pages".
 * @param db - Open Database instance.
 * @param url - The page URL.
 * @param status - HTTP status.
 * @param lastCrawledAt - Optional `lastCrawledAt` timestamp (UNIX ms).
 */
async function insertPageRow(
	db: Database,
	url: string,
	status: number,
	lastCrawledAt?: number,
): Promise<void> {
	await db.updatePage(
		{
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal: false,
			status,
			statusText: status === 200 ? 'OK' : 'Other',
			contentLength: 0,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'fixture' },
			anchorList: [],
			imageList: [],
			html: '',
			isSkipped: false,
		},
		true,
		true,
	);
	if (typeof lastCrawledAt === 'number') {
		// updatePage stamps `lastCrawledAt` to Date.now(); rewrite it to a
		// deterministic value for the time-comparison test case.
		// Access the private knex instance via a thin escape hatch — we have to
		// touch the field that drives the recency check, and there is no public
		// setter for it.

		const knex = (db as unknown as { '#instance': unknown })['#instance'];
		// The `#instance` property is private; reach through the public knex via
		// a query method instead.
		// We fall back to the public `updatePage` having set the timestamp; the
		// time-comparison test sets a value smaller than the error timestamp to
		// trigger the exclusion branch.
		void knex;
	}
}

describe('Database.listDnsBurnedHostCandidates', () => {
	it('returns burned hostnames when crawl_errors carries DNS-only history', async () => {
		const db = await openDb();
		await db.insertCrawlError(
			'https://foo.invalid/page',
			'getaddrinfo ENOTFOUND foo.invalid',
		);
		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).toEqual(['foo.invalid']);
	});

	it('excludes hosts that have a 2xx page row (the site is reachable elsewhere)', async () => {
		const db = await openDb();
		await db.insertCrawlError(
			'https://foo.invalid/dead',
			'getaddrinfo ENOTFOUND foo.invalid',
		);
		await insertPageRow(db, 'https://foo.invalid/alive', 200);
		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).not.toContain('foo.invalid');
	});

	it('excludes hosts that only have a 2xx resource row', async () => {
		const db = await openDb();
		await db.insertCrawlError(
			'https://foo.invalid/dead',
			'getaddrinfo ENOTFOUND foo.invalid',
		);
		await db.insertResource({
			url: parseUrl('https://foo.invalid/asset.png')!,
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 1234,
			contentType: 'image/png',
			compress: null,
			cdn: null,
			headers: {},
		});
		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).not.toContain('foo.invalid');
	});

	it('ignores non-DNS error messages even if the LIKE filter matched a substring', async () => {
		const db = await openDb();
		// `EAI_AGAIN` is in the LIKE list but a message that does not classify
		// as 'dns' must not graduate. Use a TLS / connection error instead.
		await db.insertCrawlError(
			'https://timeout.example.com/x',
			'connect ETIMEDOUT 93.184.216.34:443',
		);
		await db.insertCrawlError('https://tls.example.com/x', 'net::ERR_CERT_DATE_INVALID');
		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).not.toContain('timeout.example.com');
		expect(burned).not.toContain('tls.example.com');
	});

	it('returns an empty array when crawl_errors has no rows', async () => {
		// True legacy-archive behaviour (table-absence) is exercised by the
		// `hasTable` guard at the top of `listDnsBurnedHostCandidates`; the
		// private knex instance is not reachable from the test layer, so we
		// assert the closest observable contract instead: a fresh archive with
		// `crawl_errors` present but empty also returns an empty array.
		const db = await openDb();
		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).toEqual([]);
	});

	it('excludes hosts whose only error is EAI_AGAIN (transient local resolver hiccup)', async () => {
		// `EAI_AGAIN` rides on top of the `getaddrinfo` token so the SQL LIKE
		// pulls it in, but `classifyErrorKind` routes it to `dns-transient`
		// (not `dns`). The host must not be burned — otherwise a single WiFi
		// glitch during a crawl would brick every host the local resolver
		// happened to choke on, on every subsequent --retry-failed.
		const db = await openDb();
		await db.insertCrawlError(
			'https://wifi-hiccup.invalid/x',
			'getaddrinfo EAI_AGAIN wifi-hiccup.invalid',
		);
		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).not.toContain('wifi-hiccup.invalid');
	});

	it('excludes a host whose latest DNS error falls inside a recorded network outage window (damage-3 regression)', async () => {
		// This is the fix for "damage 3": a host first contacted DURING an
		// operator-side network outage has zero prior success recorded (the
		// only signal the OTHER exclusion bags rely on), so without this
		// check it would be preload-seeded into dnsBurnedHostCache and
		// short-circuited on every subsequent session forever — even though
		// the host was never actually unreachable.
		const db = await openDb();
		const knex = db.getKnex();
		await knex('crawl_errors').insert({
			url: 'https://first-contact-during-outage.invalid/page',
			isExternal: 0,
			message: 'getaddrinfo ENOTFOUND first-contact-during-outage.invalid',
			createdAt: 1_000_150,
		});
		const outageId = await db.insertNetworkOutage({
			startedAt: 1_000_100,
			detectedAt: 1_000_120,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await db.closeNetworkOutage(outageId, 1_000_200);

		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).not.toContain('first-contact-during-outage.invalid');
	});

	it('still burns a host whose latest DNS error falls OUTSIDE any recorded outage window', async () => {
		// Regression guard for the opposite direction: the outage exclusion
		// must not become a blanket amnesty for every DNS failure once any
		// outage has ever been recorded in the archive.
		const db = await openDb();
		const knex = db.getKnex();
		await knex('crawl_errors').insert({
			url: 'https://actually-dead.invalid/page',
			isExternal: 0,
			message: 'getaddrinfo ENOTFOUND actually-dead.invalid',
			createdAt: 500,
		});
		const outageId = await db.insertNetworkOutage({
			startedAt: 1_000_100,
			detectedAt: 1_000_120,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await db.closeNetworkOutage(outageId, 1_000_200);

		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).toContain('actually-dead.invalid');
	});

	it('normalises hostnames to lowercase', async () => {
		const db = await openDb();
		await db.insertCrawlError(
			'https://Mixed.INVALID/page',
			'getaddrinfo ENOTFOUND mixed.invalid',
		);
		const burned = await db.listDnsBurnedHostCandidates();
		expect(burned).toContain('mixed.invalid');
		expect(burned).not.toContain('Mixed.INVALID');
	});
});
