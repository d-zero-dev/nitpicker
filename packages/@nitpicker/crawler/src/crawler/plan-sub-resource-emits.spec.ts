import type { ResourceEntry } from '@d-zero/beholder';
import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, expect, it } from 'vitest';

import { planSubResourceEmits } from './plan-sub-resource-emits.js';

/**
 * Build a minimal `ResourceEntry` for the planner. Only the fields the
 * planner actually consults (`resource.url.withoutHash`, the resource
 * payload as a whole, and `pageUrl`) need real values — everything else is
 * stubbed so the test stays focused on the lineage / dedup contract.
 * @param resourceUrl - The URL string for the resource itself.
 * @param pageUrl - The URL string of the page that triggered the fetch.
 * @returns A `ResourceEntry` with realistic enough shape for the planner.
 */
const makeEntry = (resourceUrl: string, pageUrl: string): ResourceEntry => {
	const parsed = parseUrl(resourceUrl) as ExURL;
	return {
		log: {} as ResourceEntry['log'],
		resource: {
			url: parsed,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: null,
		},
		pageUrl,
	};
};

describe('planSubResourceEmits', () => {
	it('stamps `inventory-discovered` on every `response` emit when the parent is `inventory-seed`', () => {
		// The lineage propagation contract: a sub-resource captured while
		// rendering an inventory-seed parent is itself in the inventory
		// chain — not a new seed, but a transitively reached asset. Pin the
		// stamped `source` directly on the planned emit so a future
		// refactor that drops the `parentSource` argument from
		// `deriveResourceSource(...)` is caught by this test.
		const entry = makeEntry(
			'https://example.com/style.css',
			'https://example.com/parent',
		);
		const plan = planSubResourceEmits([entry], 'inventory-seed', new Set<string>());
		expect(plan.responseEmits).toHaveLength(1);
		expect(plan.responseEmits[0]!.source).toBe('inventory-discovered');
	});

	it('stamps `inventory-discovered` on every `response` emit when the parent is `inventory-discovered`', () => {
		// Lineage is transitive: a sub-resource of a transitively-reached
		// inventory page is still in the inventory chain. Without this
		// half of the OR in `deriveResourceSource`, multi-hop inventory
		// descendants would silently start carrying `'crawled'` after the
		// first hop, breaking the orphan-vs-reachable contract.
		const entry = makeEntry(
			'https://example.com/style.css',
			'https://example.com/parent',
		);
		const plan = planSubResourceEmits([entry], 'inventory-discovered', new Set<string>());
		expect(plan.responseEmits).toHaveLength(1);
		expect(plan.responseEmits[0]!.source).toBe('inventory-discovered');
	});

	it('leaves `source` undefined on every `response` emit when the parent is `crawled`', () => {
		// A `'crawled'`-lineage parent means the sub-resource is part of the
		// normal crawl graph — no source label is needed, the DB DEFAULT
		// `'crawled'` lands on the row. The planner returns `undefined` so
		// `setResources` can omit the column from its INSERT.
		const entry = makeEntry(
			'https://example.com/style.css',
			'https://example.com/parent',
		);
		const plan = planSubResourceEmits([entry], 'crawled', new Set<string>());
		expect(plan.responseEmits).toHaveLength(1);
		expect(plan.responseEmits[0]!.source).toBeUndefined();
	});

	it('leaves `source` undefined when the parent source is `undefined` (no lineage record)', () => {
		// Outside `--inventory` mode AND outside resume of an inventoried
		// archive, `#resolveParentSource` returns `undefined`. The planner
		// must NOT silently promote sub-resources to any inventory label
		// when there is no positive evidence the parent is in the chain.
		const entry = makeEntry(
			'https://example.com/style.css',
			'https://example.com/parent',
		);
		const plan = planSubResourceEmits([entry], undefined, new Set<string>());
		expect(plan.responseEmits).toHaveLength(1);
		expect(plan.responseEmits[0]!.source).toBeUndefined();
	});

	it('emits one `response` per fresh resource and skips duplicates', () => {
		// Dedup contract: a resource URL already in `seenResources` must NOT
		// produce a second `response` emit. The planner mirrors the
		// `Crawler.#resources` Set semantics — `handleResourceResponse`
		// short-circuits on repeats and the planner respects that flag.
		const entryA = makeEntry('https://example.com/a.css', 'https://example.com/parent');
		const entryB = makeEntry('https://example.com/b.css', 'https://example.com/parent');
		const entryADuplicate = makeEntry(
			'https://example.com/a.css',
			'https://example.com/parent',
		);
		const seen = new Set<string>();
		const plan = planSubResourceEmits(
			[entryA, entryB, entryADuplicate],
			'inventory-seed',
			seen,
		);
		expect(plan.responseEmits.map((emit) => emit.resource.url.withoutHash)).toEqual([
			'https://example.com/a.css',
			'https://example.com/b.css',
		]);
	});

	it('emits `responseReferrers` for EVERY resource, even duplicates', () => {
		// Referrer edges are not deduped — every page that touches a
		// resource records its own edge so `query unused-resources` /
		// `getReferrers` can return the complete fan-in. Pin this contract
		// so a future "optimize by deduping" change does not silently lose
		// edges.
		const entryFromPageA = makeEntry(
			'https://example.com/shared.css',
			'https://example.com/page-a',
		);
		const entryFromPageB = makeEntry(
			'https://example.com/shared.css',
			'https://example.com/page-b',
		);
		const plan = planSubResourceEmits(
			[entryFromPageA, entryFromPageB],
			'crawled',
			new Set<string>(),
		);
		expect(plan.referrerEmits).toEqual([
			{ url: 'https://example.com/page-a', src: 'https://example.com/shared.css' },
			{ url: 'https://example.com/page-b', src: 'https://example.com/shared.css' },
		]);
	});

	it('mutates `seenResources` in place so subsequent calls dedupe correctly', () => {
		// Caller responsibility test: the planner is meant to share the
		// Crawler's long-lived `#resources` Set, so the seen state must
		// survive across calls. Inlining the dedup inside the planner
		// (i.e. creating a fresh Set per call) would break the contract
		// silently — the symptom would be every cross-page CSS / JS / font
		// emitting `response` again on the next page render, polluting the
		// archive with duplicate resource rows.
		const seen = new Set<string>();
		planSubResourceEmits(
			[makeEntry('https://example.com/a.css', 'https://example.com/page-a')],
			'crawled',
			seen,
		);
		const secondPlan = planSubResourceEmits(
			[makeEntry('https://example.com/a.css', 'https://example.com/page-b')],
			'crawled',
			seen,
		);
		expect(secondPlan.responseEmits).toHaveLength(0);
		expect(secondPlan.referrerEmits).toHaveLength(1);
	});
});
