// Loads a built `.node` file directly (no workspace install needed) and checks
// it against the body-hash golden fixture, then runs one small template
// classification to its known keys — a smoke check that the export
// works in this build, not a substitute for the template golden records.
// CI runs this on every prebuilt binary — on the platform it targets —
// before it can be published.
// Usage: node verify-prebuilt.mjs <path-to-addon.node>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

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
