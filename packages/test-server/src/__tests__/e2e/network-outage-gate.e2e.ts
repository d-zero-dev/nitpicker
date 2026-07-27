import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

/** Shape of a `network_outages` row as returned by a raw `knex(...)` select. */
interface NetworkOutageRow {
	id: number;
	started_at: number;
	detected_at: number;
	ended_at: number | null;
	probe_host: string | null;
	trigger_error_count: number;
	trigger_host_count: number;
}

/**
 * Real, guaranteed-unresolvable hostnames (RFC 2606) used to trigger genuine
 * `dns`-classified failures through the crawler's real HEAD pre-flight path
 * (`#sendHeadRequest` → `retryCall`'s `onGiveUp` → `#recordNetworkError`)
 * without depending on the actual state of any real network or DNS server.
 * `.invalid` is reserved to never resolve, on any resolver, ever — the one
 * "real network condition" that is fully hermetic to simulate in CI.
 */
const INVALID_HOSTS = [
	'outage-trigger-a.invalid',
	'outage-trigger-b.invalid',
	'outage-trigger-c.invalid',
	'outage-trigger-d.invalid',
];

describe('Network outage detection gate (real DNS failures, injected probe)', () => {
	describe('false alarm: the sliding window trips but the probe reports the network is fine', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(
				[
					`http://localhost:${TEST_SERVER_PORT}/`,
					...INVALID_HOSTS.slice(0, 2).map((host) => `https://${host}/`),
				],
				{
					// `retries: 0` hits a real bug in `@d-zero/shared`'s
					// `retryCall` (it reads the not-yet-set first-attempt error
					// before ever calling the function once) — `1` is the
					// smallest value that actually attempts the HEAD request.
					retry: 1,
					networkOutageWindowMs: 60_000,
					networkOutageErrorThreshold: 2,
					networkOutageHostThreshold: 2,
					networkOutageProbeIntervalMs: 50,
					// Always reachable: the confirming probe never sees a failure,
					// so `#handleOutageSuspect` returns on the false-alarm branch
					// and the gate never closes.
					networkProbe: () => Promise.resolve(true),
				},
			);
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('does not record a network_outages row — the probe never confirmed a real outage', async () => {
			const rows = (await result.accessor
				.getKnex()('network_outages')
				.select('*')) as NetworkOutageRow[];
			expect(rows).toHaveLength(0);
		});

		it('both unresolvable roots are still recorded in crawl_errors', async () => {
			const rows = (await result.accessor
				.getKnex()('crawl_errors')
				.select('url', 'message')) as { url: string; message: string }[];
			for (const host of INVALID_HOSTS.slice(0, 2)) {
				const row = rows.find((r) => r.url.includes(host));
				expect(row, `expected a crawl_errors row for ${host}`).toBeDefined();
				expect(row!.message).toContain('ENOTFOUND');
			}
		});
	});

	describe('confirmed outage: the probe fails, then recovers', () => {
		let result: CrawlResult;
		let probeCalls: number;

		beforeAll(async () => {
			probeCalls = 0;
			result = await crawl(
				[
					`http://localhost:${TEST_SERVER_PORT}/`,
					...INVALID_HOSTS.map((host) => `https://${host}/`),
				],
				{
					retry: 1,
					networkOutageWindowMs: 60_000,
					networkOutageErrorThreshold: 2,
					networkOutageHostThreshold: 2,
					// Short so the recovery loop settles almost instantly —
					// the point under test is the record's lifecycle, not the
					// interval itself (that is covered by unit tests).
					networkOutageProbeIntervalMs: 50,
					// Fails the confirming probe and the first recovery probe,
					// succeeds from the third call onward — deterministic
					// confirm-then-recover without touching the real network.
					networkProbe: () => {
						probeCalls += 1;
						return Promise.resolve(probeCalls > 2);
					},
				},
			);
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('records exactly one network_outages row, closed with a valid endedAt', async () => {
			const rows = (await result.accessor
				.getKnex()('network_outages')
				.select('*')) as NetworkOutageRow[];
			expect(rows).toHaveLength(1);
			const row = rows[0]!;
			expect(row.ended_at).not.toBeNull();
			expect(row.ended_at!).toBeGreaterThanOrEqual(row.started_at);
			expect(row.trigger_error_count).toBeGreaterThanOrEqual(2);
			expect(row.trigger_host_count).toBeGreaterThanOrEqual(2);
			expect(row.probe_host).toBeTruthy();
		});

		it('every root URL is still recorded in crawl_errors once the gate reopens (none silently lost)', async () => {
			const rows = (await result.accessor
				.getKnex()('crawl_errors')
				.select('url', 'message')) as { url: string; message: string }[];
			for (const host of INVALID_HOSTS) {
				const row = rows.find((r) => r.url.includes(host));
				expect(row, `expected a crawl_errors row for ${host}`).toBeDefined();
				expect(row!.message).toContain('ENOTFOUND');
			}
		});
	});
});
