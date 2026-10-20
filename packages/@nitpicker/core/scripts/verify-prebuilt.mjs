// Loads a built `.node` file directly (no workspace install needed) and checks
// it against the body-hash and technology-signal golden fixtures and one
// license banner, then runs one small template
// classification to its known keys, one URL ranking, one pair of alias keys,
// one alias grouping, one isolated-components run and one match-selector batch
// over a zstd-compressed snapshot — a smoke check that
// the exports work in this build, not a substitute for the template golden
// records, the URL order tests or the alias parity tests.
// CI runs this on every prebuilt binary — on the platform it targets —
// before it can be published.
// Usage: node verify-prebuilt.mjs <path-to-addon.node>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const addonPath = process.argv[2];
if (!addonPath) {
	console.error('usage: node verify-prebuilt.mjs <path-to-addon.node>');
	process.exit(2);
}

const binding = createRequire(import.meta.url)(path.resolve(addonPath));
const golden = JSON.parse(
	readFileSync(
		new URL(
			'../crates/nitpicker_html_scan/tests/fixtures/body-hash-golden.json',
			import.meta.url,
		),
		'utf8',
	),
);

let failures = 0;
for (const { name, utf8Hex, hash } of golden) {
	const actual = binding.computeBodyHash(Buffer.from(utf8Hex, 'hex')).toString('hex');
	if (actual !== hash) {
		failures++;
		console.error(`MISMATCH ${name}: expected ${hash}, got ${actual}`);
	}
}

if (failures > 0) {
	console.error(`${failures}/${golden.length} golden cases failed for ${addonPath}`);
	process.exit(1);
}
console.log(`${golden.length} golden cases passed for ${addonPath}`);

const technologyGolden = JSON.parse(
	readFileSync(
		new URL(
			'../crates/nitpicker_tech_detect/tests/fixtures/technology-signals-golden.json',
			import.meta.url,
		),
		'utf8',
	),
);
for (const { name, utf8Hex, signals } of technologyGolden) {
	const actual = binding.matchStructuralTechnologySignals(Buffer.from(utf8Hex, 'hex'));
	if (!isDeepStrictEqual(actual, signals)) {
		failures++;
		console.error(
			`MISMATCH ${name}: expected ${JSON.stringify(signals)}, got ${JSON.stringify(actual)}`,
		);
	}
}
if (failures > 0) {
	console.error(
		`${failures}/${technologyGolden.length} technology golden cases failed for ${addonPath}`,
	);
	process.exit(1);
}
const license = binding.matchJsLicenseCommentSignal(
	Buffer.from('/*!\n * Vue.js v3.4.21\n */'),
);
const expectedLicense = {
	technology: 'Vue',
	signalType: 'js-license-comment',
	evidence: '/*!\n * Vue.js v3',
	weight: 55,
	category: 'JavaScript frameworks',
};
if (!isDeepStrictEqual(license, expectedLicense)) {
	console.error(
		`MISMATCH license banner: expected ${JSON.stringify(expectedLicense)}, got ${JSON.stringify(license)}`,
	);
	process.exit(1);
}
console.log(`${technologyGolden.length} technology golden cases passed for ${addonPath}`);

// Two layouts in one block split into two clusters.
const LIST = '<body><main><ul><li><a>x</a></li><li><a>y</a></li></ul></main></body>';
const DETAIL =
	'<body><main><article><h1>t</h1><p>p</p><figure><img></figure></article></main></body>';
const run = new binding.TemplateClassificationRun();
run.pushSignals(
	['1', '2', '3', '4'].map((page) => ({
		paths: ['news', page],
		stylesheetHrefs: [],
		stylesheetHosts: [],
	})),
);
await run.block();
await run.pushPages([LIST, LIST, DETAIL, DETAIL].map((html) => ({ html })));
await run.finishPages();
const { output } = await run.takeOutput();
const { keys, keyOfPage } = output;
const templateKeys = Array.from(keyOfPage, (key) => keys[key]).join(' ');
const expectedTemplateKeys =
	'["path:news","cluster:0"] ["path:news","cluster:0"] ["path:news","cluster:1"] ["path:news","cluster:1"]';
if (templateKeys !== expectedTemplateKeys) {
	console.error(
		`MISMATCH template classification: expected ${expectedTemplateKeys}, got ${templateKeys}`,
	);
	process.exit(1);
}
console.log(`Template classification smoke check passed for ${addonPath}`);

// Numbers compare by value and the root page comes first; the host decides
// before the path.
const sortUrls = [
	'https://b.example.com/a',
	'https://a.example.com/page10',
	'https://a.example.com/page2',
	'https://a.example.com/',
];
const urlBytes = Buffer.from(sortUrls.join(''), 'utf8');
const urlOffsets = new Uint32Array(sortUrls.length + 1);
for (const [index, url] of sortUrls.entries()) {
	urlOffsets[index + 1] = urlOffsets[index] + Buffer.byteLength(url, 'utf8');
}
const ranks = [...binding.computeUrlSortRanks(urlBytes, urlOffsets)].join(' ');
if (ranks !== '3 2 1 0') {
	console.error(`MISMATCH url sort ranks: expected 3 2 1 0, got ${ranks}`);
	process.exit(1);
}
console.log(`URL sort ranks smoke check passed for ${addonPath}`);

// The scheme, the host's case and a trailing `/index.{ext}` fold into one
// Tier A key; Tier B also drops the trailing slash.
const aliasKeys = binding.computeAliasKeys('http://Example.com/about/index.html');
if (
	aliasKeys?.tierA !== 'example.com/about/' ||
	aliasKeys.tierB !== 'example.com/about'
) {
	console.error(`MISMATCH alias keys: got ${JSON.stringify(aliasKeys)}`);
	process.exit(1);
}
console.log(`Alias keys smoke check passed for ${addonPath}`);

// Two pages of one group: the shorter URL is the representative (index 1), and
// a page of its own stays alone.
const aliasUrls = [
	'http://example.com/a/index.html',
	'https://example.com/a/',
	'https://example.com/b/',
];
const aliasUrlBytes = Buffer.from(aliasUrls.join(''), 'utf8');
const aliasUrlOffsets = new Uint32Array(aliasUrls.length + 1);
for (const [index, url] of aliasUrls.entries()) {
	aliasUrlOffsets[index + 1] = aliasUrlOffsets[index] + Buffer.byteLength(url, 'utf8');
}
const representatives = [
	...binding.groupAliasCandidates({
		urls: aliasUrlBytes,
		urlOffsets: aliasUrlOffsets,
		urlIds: Uint32Array.of(1, 2, 3),
		titleTextIds: Uint32Array.of(1, 1, 1),
		canonicalUrlIds: Uint32Array.of(4_294_967_295, 4_294_967_295, 4_294_967_295),
		bodyHashes: new Uint8Array(),
		hashOffsets: new Uint32Array(4),
		hashPresent: Uint8Array.of(0, 0, 0),
	}),
].join(' ');
if (representatives !== '1 4294967295 4294967295') {
	console.error(
		`MISMATCH alias grouping: expected 1 4294967295 4294967295, got ${representatives}`,
	);
	process.exit(1);
}
console.log(`Alias grouping smoke check passed for ${addonPath}`);

// Candidates 10, 20, 30 with page 40 redirecting to 30: the edge 20 → 40 is an
// edge to 30, so all three are one component.
const isolatedRun = new binding.IsolatedClusterRun(
	Uint32Array.of(10, 20, 30),
	Uint32Array.of(40, 30),
);
isolatedRun.unionEdges(Uint32Array.of(10, 20, 20, 40));
const components = [...isolatedRun.labels()].join(' ');
if (components !== '0 0 0') {
	console.error(`MISMATCH isolated components: expected 0 0 0, got ${components}`);
	process.exit(1);
}
console.log(`Isolated components smoke check passed for ${addonPath}`);

// A zstd-compressed snapshot and a plain one, judged against `img[alt]` (one
// start tag decides) and `nav > a` (the open-element stack): the zstd decoder
// is linked into this build, and both stages answer. Bit 0 matched, bit 1
// prefiltered, bit 2 judged on the stack.
const imgAlt = {
	alternatives: [
		{
			compounds: [
				{
					tag: 'img',
					attributes: [{ name: 'alt', operator: 'exists', value: '', ignoreCase: false }],
					nth: [],
					negations: [],
				},
			],
			combinators: [],
			prefilterLiterals: ['<img'],
			direct: true,
		},
	],
	needsChildIndex: false,
	needsTypeIndex: false,
};
const navChild = {
	alternatives: [
		{
			compounds: [
				{ tag: 'nav', attributes: [], nth: [], negations: [] },
				{ tag: 'a', attributes: [], nth: [], negations: [] },
			],
			combinators: ['child'],
			prefilterLiterals: ['<nav', '<a'],
			direct: false,
		},
	],
	needsChildIndex: false,
	needsTypeIndex: false,
};
// `<p><img alt=""></p>` as zstd (`zlib.zstdCompressSync`); kept as bytes so this
// script needs no compressor.
const zstdSnapshot = Buffer.from(
	'28b52ffd20139900003c703e3c696d6720616c743d22223e3c2f703e',
	'hex',
);
const plainSnapshot = Buffer.from('<nav><a href="/">x</a></nav>');
const snapshotBodies = Buffer.concat([zstdSnapshot, plainSnapshot]);
const snapshotOffsets = Uint32Array.of(
	0,
	zstdSnapshot.length,
	zstdSnapshot.length + plainSnapshot.length,
);
const snapshotCodecs = Uint8Array.of(1, 0);
const imgVerdicts = [
	...(await binding.matchSelectorSnapshots(
		imgAlt,
		snapshotBodies,
		snapshotOffsets,
		snapshotCodecs,
	)),
].join(' ');
const navVerdicts = [
	...(await binding.matchSelectorSnapshots(
		navChild,
		snapshotBodies,
		snapshotOffsets,
		snapshotCodecs,
	)),
].join(' ');
// img[alt]: the zstd snapshot matches (1), the plain one lacks `<img` (prefiltered, 2).
// nav > a: the zstd one lacks `<nav` (prefiltered, 2), the plain one matches on the stack (1 | 4).
if (imgVerdicts !== '1 2' || navVerdicts !== '2 5') {
	console.error(
		`MISMATCH match-selector snapshots: expected "1 2" and "2 5", got "${imgVerdicts}" and "${navVerdicts}"`,
	);
	process.exit(1);
}
const single = binding.matchSelectorHtml(navChild, Buffer.from('<nav><a>x</a></nav>'));
if (!single.matched || !single.tokenized || single.elementsVisited !== 2) {
	console.error(`MISMATCH match-selector html: got ${JSON.stringify(single)}`);
	process.exit(1);
}
console.log(`Match-selector smoke check passed for ${addonPath}`);
