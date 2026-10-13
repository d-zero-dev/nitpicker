// Writes `crates/nitpicker_html_parser/tests/htmlparser2-fixture-events.tsv`:
// for every HTML fixture of the template classifier (whole, and cut after a
// third and two thirds of its code points), the number of open/close events
// htmlparser2 12.0.0 reports and a digest of them, which
// `tests/htmlparser2_fixture_events.rs` compares the port against.
//
//   node scripts/record-htmlparser2-events.mjs <htmlparser2 package directory>
//
// Nothing in the repository depends on htmlparser2, so its directory is
// passed in (an install of exactly the pinned version, which the script
// checks — e.g. `yarn add htmlparser2@12.0.0` in a scratch directory).
// Re-record only when fixtures are added or changed: the events are the
// reference the port must match, so recording them from the port itself
// would make the test pass vacuously.
//
// Each event is one line, `kind<TAB>name<TAB>start<TAB>end`, kind being
// `open`, `close` or `implied` (htmlparser2's `isImplied`) and the indices
// `parser.startIndex` / `parser.endIndex` turned into UTF-8 byte offsets (the
// port's unit); an open adds `class`, `role`, `type` and `id` as decoded, each
// `-` when absent or `<UTF-8 byte length>:<value>`. The digest is 64-bit
// FNV-1a over the UTF-8 bytes of the lines joined with `\n`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PINNED_VERSION = '12.0.0';
const FIXTURES = 'archive/src/template-classification/page-cluster/__fixtures__';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlparser2Dir = process.argv[2];
if (!htmlparser2Dir) {
	console.error(
		'Usage: node scripts/record-htmlparser2-events.mjs <htmlparser2 package directory>',
	);
	process.exit(1);
}
const { version } = JSON.parse(
	readFileSync(path.join(htmlparser2Dir, 'package.json'), 'utf8'),
);
if (version !== PINNED_VERSION) {
	console.error(
		`htmlparser2@${version} given; the events must come from htmlparser2@${PINNED_VERSION}.`,
	);
	process.exit(1);
}
const { Parser } = await import(
	pathToFileURL(path.join(htmlparser2Dir, 'dist', 'index.js')).href
);

const FNV_OFFSET = 0xcb_f2_9c_e4_84_22_23_25n;
const FNV_PRIME = 0x1_00_00_00_01_b3n;
const MASK = (1n << 64n) - 1n;

/**
 * @param {string} text
 */
function fnv1a64(text) {
	let hash = FNV_OFFSET;
	for (const byte of Buffer.from(text, 'utf8')) {
		hash ^= BigInt(byte);
		hash = (hash * FNV_PRIME) & MASK;
	}
	return hash.toString(16).padStart(16, '0');
}

/**
 * @param {string | undefined} value
 */
function field(value) {
	return value === undefined ? '-' : `${Buffer.byteLength(value, 'utf8')}:${value}`;
}

/**
 * @param {string} html
 */
function record(html) {
	// UTF-16 index → UTF-8 byte offset.
	const byteOffset = new Uint32Array(html.length + 1);
	let bytes = 0;
	for (let index = 0; index < html.length; index++) {
		byteOffset[index] = bytes;
		// One UTF-16 unit at a time, as htmlparser2's indices count them.
		// eslint-disable-next-line unicorn/prefer-code-point
		const code = html.charCodeAt(index);
		if (code < 0x80) bytes += 1;
		else if (code < 0x8_00) bytes += 2;
		// A surrogate pair is 4 bytes, counted on its first half.
		else if (code >= 0xd8_00 && code < 0xdc_00) bytes += 4;
		else if (code >= 0xdc_00 && code < 0xe0_00) bytes += 0;
		else bytes += 3;
	}
	byteOffset[html.length] = bytes;
	// Closes implied at the end of a document cut inside a CDATA section or a
	// comment report indices past its end; the overshoot carries over as is.
	const toBytes = (index) =>
		index <= html.length ? byteOffset[index] : bytes + index - html.length;

	const lines = [];
	const parser = new Parser({
		onopentag(name, attributes) {
			lines.push(
				[
					'open',
					name,
					toBytes(parser.startIndex),
					toBytes(parser.endIndex),
					field(attributes.class),
					field(attributes.role),
					field(attributes.type),
					field(attributes.id),
				].join('\t'),
			);
		},
		onclosetag(name, isImplied) {
			lines.push(
				[
					isImplied ? 'implied' : 'close',
					name,
					toBytes(parser.startIndex),
					toBytes(parser.endIndex),
				].join('\t'),
			);
		},
	});
	parser.end(html);
	return `${lines.length}\t${fnv1a64(lines.join('\n'))}`;
}

/**
 * @param {string} directory
 * @returns {string[]} Paths relative to `directory`, sorted.
 */
function htmlFiles(directory) {
	return readdirSync(directory, { recursive: true })
		.filter((file) => file.endsWith('.html'))
		.map((file) => file.split(path.sep).join('/'))
		.toSorted();
}

const fixturesDir = path.resolve(packageDir, '..', FIXTURES);
const rows = [];
for (const file of htmlFiles(fixturesDir)) {
	const html = readFileSync(path.join(fixturesDir, file), 'utf8');
	const codePoints = [...html];
	rows.push(`${file}\tall\t${record(html)}`);
	for (const fraction of [1, 2]) {
		const count = Math.floor((codePoints.length * fraction) / 3);
		rows.push(`${file}\t${count}\t${record(codePoints.slice(0, count).join(''))}`);
	}
}

const output = path.join(
	packageDir,
	'crates/nitpicker_html_parser/tests/htmlparser2-fixture-events.tsv',
);
writeFileSync(output, `${rows.join('\n')}\n`);
console.log(`${rows.length} rows → ${path.relative(packageDir, output)}`);
