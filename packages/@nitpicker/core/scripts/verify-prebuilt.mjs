// Loads a built `.node` file directly (no workspace install needed) and checks
// it against the body-hash golden fixture. CI runs this on every prebuilt
// binary — on the platform it targets — before it can be published.
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
