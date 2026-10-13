/**
 * The native classification (Pass 0, Stage A, Stage B and the reasons in
 * `@nitpicker/core`) against the TypeScript driver it replaces (Pass 0,
 * Stage B and the reasons in TypeScript around the native Stage A), on
 * corpora the golden records do not cover: the synthetic site under other
 * seeds, its signals randomly disturbed (page hosts, third-party and
 * malformed stylesheet hrefs, pages without stylesheets, moved sections),
 * and the HTML fixtures under random URL sections and stylesheets.
 *
 * Each corpus must give the same key for every page and the same stored
 * reason JSON for every cluster.
 */
import type { ClusterReason } from './page-cluster/build-cluster-reason.js';
import type { PageClusterSignals } from './page-cluster/resolve-page-cluster-keys.js';

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { serializeTemplateClusterReason } from '../db-ops/templates/serialize-template-cluster-reason.js';

import { buildFixtureCorpus } from './golden/build-fixture-corpus.js';
import { buildSyntheticSite } from './golden/build-synthetic-site.js';
import { createSeededRandom } from './golden/create-seeded-random.js';
import { resolvePageClusterKeys as resolveNative } from './page-cluster/resolve-page-cluster-keys-native.js';
import { resolvePageClusterKeys as resolveTypeScript } from './page-cluster/resolve-page-cluster-keys.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'page-cluster', '__fixtures__');

/** Stylesheet hrefs the disturbance adds: other hosts, odd spellings of the site's own, unparsable. */
const EXTRA_HREFS = [
	'https://fonts.cdn.example/css?family=a',
	'https://fonts.cdn.example/css?family=b',
	'https://widgets.example/embed.css',
	'https://GOLDEN.example:443/assets/upper.css',
	'http://golden.example/assets/plain-http.css',
	'https://golden.example:8443/assets/port.css',
	'https://xn--bcher-kva.example/a.css',
	'https://bücher.example/a.css',
	'not a url',
	'/assets/relative.css',
	'data:text/css,body{}',
	'https://[2001:db8::1]/a.css',
	'https://192.0.2.1/a.css',
];

const SECTIONS = ['news', 'blog', 'docs', 'products', '', 'ニュース', 'a%20b'];

/**
 * A copy of `pages` with its signals disturbed at random.
 * @param pages
 * @param seed
 */
function disturb(
	pages: readonly PageClusterSignals[],
	seed: number,
): PageClusterSignals[] {
	const random = createSeededRandom(seed);
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	return pages.map((page) => {
		let stylesheetHrefs = [...page.stylesheetHrefs];
		if (random() < 0.1) stylesheetHrefs = [];
		while (random() < 0.15) stylesheetHrefs.push(pick(EXTRA_HREFS));
		let paths = [...page.paths];
		if (random() < 0.1) paths = [pick(SECTIONS), ...paths.slice(1)];
		if (random() < 0.03) paths = [];
		const hostDraw = random();
		const host =
			hostDraw < 0.2 ? undefined : hostDraw < 0.25 ? 'golden.example:8443' : page.host;
		return {
			paths,
			stylesheetHrefs,
			html: page.html,
			...(host === undefined ? {} : { host }),
			...(page.contentRoot ? { contentRoot: page.contentRoot } : {}),
		};
	});
}

/**
 * A copy of `pages` where some pages carry no host and load their
 * stylesheets from a CDN that every hosted page also loads a font from, so
 * the dominant stylesheet host counted over all hrefs (the CDN) differs from
 * the one counted over the first-party hrefs the hosted pages keep.
 * @param pages
 * @param seed
 */
function mixHostlessCdnPages(
	pages: readonly PageClusterSignals[],
	seed: number,
): PageClusterSignals[] {
	const random = createSeededRandom(seed);
	return pages.map((page) => {
		if (random() < 0.35) {
			return {
				paths: page.paths,
				stylesheetHrefs: page.stylesheetHrefs.map((href) =>
					href.replace(/^https:\/\/[^/]+/, 'https://cdn.golden.example'),
				),
				html: page.html,
				...(page.contentRoot ? { contentRoot: page.contentRoot } : {}),
			};
		}
		return {
			...page,
			stylesheetHrefs: [...page.stylesheetHrefs, 'https://cdn.golden.example/font.css'],
		};
	});
}

/**
 * The fixtures, each under a random URL section and stylesheet set.
 * @param seed
 */
function fixturesUnderRandomSections(seed: number): PageClusterSignals[] {
	const random = createSeededRandom(seed);
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	return buildFixtureCorpus(FIXTURES_DIR).map((page, index) => ({
		paths: [pick(SECTIONS.slice(0, 4)), String(index)],
		stylesheetHrefs: Array.from(
			{ length: Math.floor(random() * 3) },
			() => `https://golden.example/assets/${pick(['a', 'b', 'c', 'd'])}.css`,
		),
		html: page.html,
		host: 'golden.example',
	}));
}

/**
 * Classifies `pages` with both drivers and expects the same keys and the
 * same stored reason JSON, over a corpus that forms several clusters.
 * @param pages
 */
async function expectAgreement(pages: readonly PageClusterSignals[]) {
	const { typeScript, native } = await classifyBoth(pages);
	expect(native.keys).toHaveLength(pages.length);
	expect(new Set(native.keys).size).toBeGreaterThan(3);
	expect(native.reasons.length).toBeGreaterThan(3);
	expect(native.keys).toEqual(typeScript.keys);
	expect(native.reasons).toEqual(typeScript.reasons);
}

/**
 * Keys and stored reason JSON from both drivers.
 * @param pages
 */
async function classifyBoth(pages: readonly PageClusterSignals[]) {
	const reasons = new Map<string, ClusterReason>();
	const typeScriptKeys = await resolveTypeScript(() => pages, {
		onProgress: () => {},
		onClusterReason: (key, reason) => reasons.set(key, reason),
	});
	const native = await resolveNative(
		() => pages.map((page) => ({ ...page, getHtml: () => page.html })),
		{ onProgress: () => {} },
	);
	const serialize = (entries: Iterable<[string, ClusterReason]>) =>
		[...entries].map(([key, reason]) => [key, serializeTemplateClusterReason(reason)]);
	return {
		typeScript: { keys: typeScriptKeys, reasons: serialize(reasons) },
		native: { keys: native.keys, reasons: serialize(native.reasons) },
	};
}

describe('native classification parity with the TypeScript driver', () => {
	it.each(Array.from({ length: 24 }, (_, index) => index + 2))(
		'agrees on the synthetic site of seed %i with disturbed signals',
		async (seed) => {
			await expectAgreement(disturb(buildSyntheticSite({ seed, scale: 1 }), seed * 7919));
		},
		120_000,
	);

	it.each(Array.from({ length: 8 }, (_, index) => index + 1))(
		'agrees on the synthetic site of seed %i with hostless pages on a shared CDN',
		async (seed) => {
			await expectAgreement(
				mixHostlessCdnPages(buildSyntheticSite({ seed, scale: 1 }), seed * 104_729),
			);
		},
		120_000,
	);

	it.each(Array.from({ length: 6 }, (_, index) => index + 1))(
		'agrees on the fixtures under random sections, seed %i',
		async (seed) => {
			await expectAgreement(fixturesUnderRandomSections(seed));
		},
		120_000,
	);

	it('agrees on a streamed synthetic site with disturbed signals', async () => {
		const pages = disturb(buildSyntheticSite({ seed: 97, scale: 80 }), 4049);
		expect(pages.length).toBeGreaterThan(20_000);
		await expectAgreement(pages);
	}, 900_000);
});
