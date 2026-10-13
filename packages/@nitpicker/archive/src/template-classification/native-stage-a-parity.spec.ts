// cspell:ignore ampb ampy notit élément
import type { ClusterReason } from './page-cluster/build-cluster-reason.js';
import type { BlockingReason } from './page-cluster/derive-blocking-reason.js';
import type { ExtractLandmarksResult } from './page-cluster/extract-landmarks.js';
import type { CrossBlockUnit } from './page-cluster/merge-cross-block-clusters.js';
import type { PageClusterSignals } from './page-cluster/resolve-page-cluster-keys.js';
import type { ContentRoot } from './page-cluster/types.js';

import { fileURLToPath } from 'node:url';

import { templateStageAParityProbe } from '@nitpicker/core/template-stage-a-parity-probe';
import { Parser } from 'htmlparser2';
import { describe, expect, it } from 'vitest';

import { buildFixtureCorpus } from './golden/build-fixture-corpus.js';
import { buildSyntheticSite } from './golden/build-synthetic-site.js';
import { createSeededRandom } from './golden/create-seeded-random.js';
import { autoCutThreshold } from './page-cluster/auto-cut-threshold.js';
import { buildClusterReason } from './page-cluster/build-cluster-reason.js';
import { capContentDepth } from './page-cluster/cap-content-depth.js';
import { DEFAULT_CANDIDATE_DEPTHS } from './page-cluster/detect-content-depth-cap.js';
import { extractLandmarks } from './page-cluster/extract-landmarks.js';
import { filterFirstPartyStylesheetHrefs } from './page-cluster/filter-first-party-stylesheet-hrefs.js';
import { mergeCrossBlockClusters } from './page-cluster/merge-cross-block-clusters.js';
import {
	groupIndicesByBlockKey,
	resolveBlockKeys,
} from './page-cluster/pass0-blocking.js';
import {
	ALL_LANDMARK_TYPES,
	computePerPageLandmarkInstances,
} from './page-cluster/per-page-landmark-signatures.js';
import { resolvePageClusterKeysFromArray } from './page-cluster/resolve-page-cluster-keys.js';
import { stageAPerBlock } from './page-cluster/stage-a-per-block.js';
import { tokenize } from './page-cluster/tokenize.js';

/** What the native probe reports for one page (byte offsets). */
interface Probe {
	readonly events: [string, string, number, number, (string | null)[]][];
	readonly tokens: string[];
	readonly classes: string[];
	readonly landmarks: [string, number, number][];
	readonly remainder: string;
	readonly content: [number, number] | null;
	readonly depthTokens: string[][];
	readonly depthTokensReparsed: string[][];
	readonly instances: [string, string[]][];
}

/**
 * Maps each UTF-8 byte offset of `html` to its UTF-16 offset (htmlparser2's
 * unit), for every offset that starts a character or ends the string.
 * @param html
 */
function byteToUtf16(html: string): Map<number, number> {
	const offsets = new Map<number, number>();
	let bytes = 0;
	let units = 0;
	for (const character of html) {
		offsets.set(bytes, units);
		bytes += Buffer.byteLength(character);
		units += character.length;
	}
	offsets.set(bytes, units);
	return offsets;
}

/**
 * htmlparser2's events for `html`, in the probe's shape: decoded `class`,
 * raw `class`, decoded `role`, decoded `type` and raw `id` of each opening
 * tag (raw values from a second parse without entity decoding).
 * @param html
 */
function htmlparser2Events(html: string): Probe['events'] {
	const record = (decodeEntities: boolean) => {
		const events: [string, string, number, number, Record<string, string> | null][] = [];
		const parser = new Parser(
			{
				onopentag(name, attribs) {
					events.push(['open', name, parser.startIndex, parser.endIndex, attribs]);
				},
				onclosetag(name, implied) {
					events.push([
						implied ? 'implied' : 'close',
						name,
						parser.startIndex,
						parser.endIndex,
						null,
					]);
				},
			},
			{ decodeEntities },
		);
		parser.end(html);
		return events;
	};
	const decoded = record(true);
	const raw = record(false);
	expect(raw.map((event) => event.slice(0, 4))).toEqual(
		decoded.map((event) => event.slice(0, 4)),
	);
	return decoded.map(([kind, name, start, end, attribs], index) => {
		const rawAttribs = raw[index]![4];
		const value = (record: Record<string, string> | null, key: string) =>
			record && Object.hasOwn(record, key) ? record[key]! : null;
		return [
			kind,
			name,
			start,
			end,
			[
				value(attribs, 'class'),
				value(rawAttribs, 'class'),
				value(attribs, 'role'),
				value(attribs, 'type'),
				value(rawAttribs, 'id'),
			],
		];
	});
}

/**
 * `tokenize`'s tokens deduplicated in first-seen order — the token set the
 * classifier compares, in the order the native output lists it.
 * @param html
 */
function distinctTokens(html: string): string[] {
	return [...new Set(tokenize(html).tokens)];
}

/**
 * The JavaScript engine's view of one page, in the probe's shape (UTF-16
 * offsets).
 * @param html
 * @param contentRoot
 */
function javascriptView(html: string, contentRoot: ContentRoot | undefined) {
	const landmarks = extractLandmarks(html);
	const instances = ALL_LANDMARK_TYPES.flatMap((type) =>
		landmarks[type].map(
			(instance) => [type, instance.startOffset, instance.endOffset] as const,
		),
	);
	const prepared = landmarks.remainderHtml;
	const depthTokens = DEFAULT_CANDIDATE_DEPTHS.map((maxDepth) =>
		distinctTokens(
			capContentDepth(prepared, { landmark: 'main', contentRoot, maxDepth })
				.remainderHtml,
		),
	);
	const perPage = computePerPageLandmarkInstances([landmarks])[0]!;
	return {
		events: htmlparser2Events(html),
		tokens: distinctTokens(html),
		classes: tokenize(html).classList,
		landmarks: instances,
		remainder: prepared,
		depthTokens,
		instances: perPage.map((instance) => [instance.type, [...instance.tokens]]),
	};
}

/**
 * The native probe for one page with its byte offsets turned into UTF-16
 * offsets.
 * @param html
 * @param contentRoot
 */
function nativeView(html: string, contentRoot: ContentRoot | undefined) {
	const probe = JSON.parse(templateStageAParityProbe(html, contentRoot)) as Probe;
	const toUtf16 = byteToUtf16(html);
	const at = (offset: number) => toUtf16.get(offset) ?? -offset - 1;
	return {
		probe,
		view: {
			events: probe.events.map(([kind, name, start, end, attributes]) => [
				kind,
				name,
				at(start),
				at(end),
				attributes,
			]),
			tokens: probe.tokens,
			classes: probe.classes,
			landmarks: probe.landmarks.map(([type, start, end]) => [type, at(start), at(end)]),
			remainder: probe.remainder,
			depthTokens: probe.depthTokens,
			instances: probe.instances,
		},
	};
}

const TAGS = [
	'div',
	'span',
	'p',
	'ul',
	'li',
	'a',
	'table',
	'tr',
	'td',
	'th',
	'tbody',
	'h1',
	'h2',
	'section',
	'article',
	'header',
	'footer',
	'nav',
	'aside',
	'main',
	'search',
	'form',
	'input',
	'select',
	'option',
	'button',
	'textarea',
	'title',
	'script',
	'style',
	'noscript',
	'svg',
	'path',
	'g',
	'foreignObject',
	'math',
	'mi',
	'br',
	'img',
	'hr',
	'body',
	'dl',
	'dt',
	'dd',
	'rt',
	'pre',
	'iframe',
	'xmp',
	'image',
	'Div',
	'SPAN',
	'x-widget',
	'my-élément',
];

const CLASS_WORDS = [
	'card',
	'Card',
	'grid',
	'list',
	'item',
	'main',
	'content',
	'mainContent',
	'_a1b2c3',
	'sc-bdVaJa',
	'css-1x2y3z',
	'chunk-a3f9c1',
	'k3j9zq2a',
	'Layout_root__f3k9d',
	'a&amp;b',
	'x&ampy',
	'&#65;',
	'%41',
	'%zz',
	'élément',
	'w-[1.5rem]',
	'a>b',
	'',
];

const ROLES = [
	'navigation',
	'main',
	'banner',
	'contentinfo',
	'complementary',
	'form',
	'search',
	'img',
	'tab',
];
const IDS = ['main', 'content', 'contents', 'main-content', 'app', 'x'];
const TEXTS = [
	'text',
	'&amp;',
	'&',
	'<',
	'< b',
	'<<',
	'a&ampb',
	'日本語',
	'😀',
	'&#x1F600;',
	'&notit;',
	'',
];

/**
 * A random, often malformed HTML document — the cases a classifier of
 * crawled pages meets: implied and stray closes, raw-text and foreign
 * elements, entities, case and quoting variants, duplicated `<body>`s.
 * @param random
 */
function randomHtml(random: () => number): string {
	const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
	const chance = (probability: number) => random() < probability;
	const attribute = (name: string, value: string) => {
		const quote = pick(['"', "'", '', '"']);
		if (quote === '' && /[\s"'=<>`]/.test(value)) return ` ${name}="${value}"`;
		return ` ${name}=${quote}${value}${quote}`;
	};
	const attributes = () => {
		let out = '';
		if (chance(0.6)) {
			const words = Array.from({ length: Math.floor(random() * 4) }, () =>
				pick(CLASS_WORDS),
			);
			out += attribute(
				pick(['class', 'CLASS', 'class']),
				words.join(pick([' ', '  ', '\t', ' 　 '])),
			);
		}
		if (chance(0.15)) out += attribute('role', pick(ROLES));
		if (chance(0.1)) out += attribute('type', pick(['text', 'submit', 'module']));
		if (chance(0.15)) out += attribute(pick(['id', 'ID']), pick(IDS));
		if (chance(0.05)) out += ' class="dup"';
		if (chance(0.05)) out += ' hidden';
		return out;
	};
	const parts: string[] = [];
	const element = (depth: number): void => {
		const roll = random();
		if (roll < 0.12) {
			parts.push(pick(TEXTS));
			return;
		}
		if (roll < 0.15) {
			parts.push(
				pick([
					'<!-- c -->',
					'<!--->',
					'<!x>',
					'<?x?>',
					'<![CDATA[x]]>',
					'</p>',
					'</br>',
					'</div >',
					'</nav>',
					'<div/>',
				]),
			);
			return;
		}
		const tag = pick(TAGS);
		parts.push(`<${tag}${attributes()}${chance(0.03) ? ' /' : ''}>`);
		if (depth < 7) {
			const children = Math.floor(random() * 4);
			for (let child = 0; child < children; child++) element(depth + 1);
		}
		if (chance(0.8))
			parts.push(`</${chance(0.1) ? tag.toUpperCase() : tag}${chance(0.03) ? ' ' : ''}>`);
	};
	const prefix = pick([
		'',
		'<!doctype html>',
		'<html><head><title>t</title><link rel="stylesheet" href="/a.css"></head>',
	]);
	parts.push(prefix, `<body${chance(0.3) ? attributes() : ''}>`);
	const roots = 1 + Math.floor(random() * 6);
	for (let root = 0; root < roots; root++) element(0);
	if (chance(0.7)) parts.push('</body>');
	if (chance(0.1)) parts.push('<body><p>second</p></body>');
	return parts.join('');
}

/**
 * A random content-root hint, or none.
 * @param random
 */
function randomContentRoot(random: () => number): ContentRoot | undefined {
	const roll = random();
	if (roll < 0.6) return undefined;
	if (roll < 0.7) return { tagName: 'DIV', id: 'x' };
	if (roll < 0.8) return { classList: ['card'] };
	if (roll < 0.9) return { role: 'main' };
	return { tagName: 'section' };
}

describe('the native Stage A against the JavaScript engine', () => {
	it('agrees page by page on random malformed HTML', () => {
		const random = createSeededRandom(426);
		for (let page = 0; page < 4000; page++) {
			const html = randomHtml(random);
			const contentRoot = randomContentRoot(random);
			const { probe, view } = nativeView(html, contentRoot);
			expect({ html, contentRoot, view }).toEqual({
				html,
				contentRoot,
				view: javascriptView(html, contentRoot),
			});
			// The event replay the native side caps with must equal cutting the
			// markup and parsing it again.
			expect(probe.depthTokens).toEqual(probe.depthTokensReparsed);
		}
	}, 120_000);

	it('agrees page by page on the bundled HTML fixtures', () => {
		const fixtures = buildFixtureCorpus(
			fileURLToPath(new URL('page-cluster/__fixtures__', import.meta.url)),
		);
		for (const page of fixtures) {
			const { probe, view } = nativeView(page.html, page.contentRoot);
			expect(view).toEqual(javascriptView(page.html, page.contentRoot));
			expect(probe.depthTokens).toEqual(probe.depthTokensReparsed);
		}
	});

	it.each([1, 7, 42, 2024, 31_337])(
		'clusters a synthetic site (seed %i) into the same keys and reasons',
		async (seed) => {
			const pages = buildSyntheticSite({ seed, scale: 1 });
			const nativeReasons = new Map<string, string>();
			const nativeKeys = await resolvePageClusterKeysFromArray(pages, {
				onClusterReason: (key, reason) => nativeReasons.set(key, JSON.stringify(reason)),
			});
			const legacy = classifyWithJavaScriptStageA(pages);
			expect(nativeKeys).toEqual(legacy.keys);
			expect(new Map([...nativeReasons].toSorted())).toEqual(
				new Map([...legacy.reasons].toSorted()),
			);
		},
	);
});

/**
 * The JavaScript engine's in-memory path (corpus-wide chrome, Stage A per
 * block, Stage B, cluster reasons), assembled from its modules the way it
 * ran before Stage A moved to the native addon.
 * @param pages
 */
function classifyWithJavaScriptStageA(pages: readonly PageClusterSignals[]): {
	keys: string[];
	reasons: Map<string, string>;
} {
	const landmarks = pages.map((page) => extractLandmarks(page.html));
	const localTokensByPage = localChromeTokens(landmarks);
	const { blockKeys, reasonsByBlockKey } = resolveBlockKeys(
		filterFirstPartyStylesheetHrefs(pages),
		{ includeReasons: true },
	);
	const keys: string[] = Array.from({ length: pages.length });
	const units: CrossBlockUnit[] = [];
	const siblingsByBlock = new Map<string, string[]>();
	for (const [blockKey, indices] of groupIndicesByBlockKey(blockKeys)) {
		const result = stageAPerBlock({
			blockKey,
			memberIndices: indices,
			preparedHtml: indices.map((index) => landmarks[index]!.remainderHtml),
			landmarks: indices.map((index) => landmarks[index]!),
			localLandmarkTokensByPage: indices.map((index) => localTokensByPage[index]!),
			contentRoots: indices.map((index) => pages[index]!.contentRoot),
		});
		for (const [index, key] of result.pageKeys) keys[index] = key;
		units.push(...result.crossBlockUnits);
		siblingsByBlock.set(
			blockKey,
			result.crossBlockUnits.map((unit) => unit.key),
		);
	}
	const { rootByKey, finalGroupsByRoot } = mergeCrossBlockClusters(units);
	for (const [index, key] of keys.entries()) keys[index] = rootByKey.get(key) ?? key;

	const reasons = new Map<string, string>();
	const unitKeysByRoot = new Map<string, string[]>();
	for (const unit of units) {
		const root = rootByKey.get(unit.key) ?? unit.key;
		unitKeysByRoot.set(root, [...(unitKeysByRoot.get(root) ?? []), unit.key]);
	}
	for (const [rootKey, unitKeys] of unitKeysByRoot) {
		const group = finalGroupsByRoot.get(rootKey);
		if (!group) continue;
		const seen = new Set<string>();
		const blocking: { blockKey: string; reason: BlockingReason }[] = [];
		const siblingRoots = new Set<string>();
		for (const unitKey of unitKeys) {
			const blockKey = JSON.parse(unitKey)[0] as string;
			if (!seen.has(blockKey)) {
				seen.add(blockKey);
				const reason = reasonsByBlockKey.get(blockKey);
				if (reason) blocking.push({ blockKey, reason });
			}
			for (const sibling of siblingsByBlock.get(blockKey) ?? []) {
				const siblingRoot = rootByKey.get(sibling) ?? sibling;
				if (siblingRoot !== rootKey) siblingRoots.add(siblingRoot);
			}
		}
		const reason: ClusterReason = buildClusterReason({
			tokenSets: group.tokenSets,
			landmarkInstances: group.landmarkInstances,
			blocking,
			siblingClusterKeys: [...siblingRoots].toSorted(),
		});
		reasons.set(rootKey, JSON.stringify(reason));
	}
	return { keys, reasons };
}

/**
 * Per page, the tokens of its local-chrome landmark instances (instances on
 * at least two pages, below the max-gap cut of how many pages carry them).
 * @param landmarks
 */
function localChromeTokens(landmarks: readonly ExtractLandmarksResult[]): Set<string>[] {
	const perPage = computePerPageLandmarkInstances(landmarks);
	const counts = new Map<string, number>();
	for (const instances of perPage) {
		for (const instance of instances) {
			counts.set(instance.signature, (counts.get(instance.signature) ?? 0) + 1);
		}
	}
	const cut = autoCutThreshold(
		[...counts.values()].map((count) => count / landmarks.length),
		0.8,
	);
	const local = new Set(
		[...counts]
			.filter(([, count]) => count >= 2 && count / landmarks.length < cut)
			.map(([signature]) => signature),
	);
	return perPage.map((instances) => {
		const tokens = new Set<string>();
		for (const instance of instances) {
			if (local.has(instance.signature))
				for (const token of instance.tokens) tokens.add(token);
		}
		return tokens;
	});
}
