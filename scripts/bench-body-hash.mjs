#!/usr/bin/env node
/**
 * Baseline: `computeBodyHash` over every stored HTML snapshot of an archive.
 *
 * Cases:
 *
 * - `rust`: the shipped native implementation (`@nitpicker/archive`'s
 *   `computeBodyHash`, fed the decompressed UTF-8 bytes as viewer-build's
 *   backfill feeds it)
 * - `js`: the JavaScript stages kept in `archive/src/body-hash/` as the
 *   parity oracle (extract → normalize → mask → SHA-256, fed a string).
 *   They are excluded from the build, so they are loaded from `src/`
 *   through Node's type stripping (Node 24 or later). The case exists only
 *   as long as those stages do: if they are deleted, delete this case
 *   (and its entry in `bench-lib/bench-cases.mjs` and `scripts/README.md`).
 *
 * `timeMs` sums the hash calls only, each timed synchronously. The first
 * snapshot is hashed once untimed beforehand, so first-call setup (the
 * native addon's lazy regex compilation, V8 parsing and first compiling the
 * JavaScript stages) is not charged to the run; V8's optimizing tiers still
 * warm up inside it, a cost that fades on archives of thousands of pages.
 * Decompression is timed separately (`decodeMs`); each case decodes into
 * the input type its implementation takes, so `js`'s `decodeMs` also
 * includes UTF-8 decoding to a string and the two cases' `decodeMs` are not
 * comparable — compare `timeMs`.
 * `msPerSnapshot` is per distinct stored snapshot: pages with identical
 * HTML share one, so it is not per page.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-body-hash.mjs <archive.nitpicker> [--case rust|js] [--json]
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { computeBodyHash } from '@nitpicker/archive/body-hash/compute-body-hash';
import { decodeStoredBlob } from '@nitpicker/archive/decode-html-blob';
import { decodeStoredBlobBytes } from '@nitpicker/archive/decode-stored-blob-bytes';

import { computeContentHash } from '../packages/@nitpicker/archive/lib/populate-ref-tables/compute-content-hash.js';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { iterateHtmlBlobs } from './bench-lib/iterate-html-blobs.mjs';
import { measureSyncMs } from './bench-lib/measure-sync-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withReadOnlyArchive } from './bench-lib/with-read-only-archive.mjs';

const { archive, caseName, json } = readBenchArguments('body-hash');

/**
 * Loads the JavaScript oracle stages from `src/` and composes them in the
 * order that produced the stored `body_hash` values.
 * @returns {Promise<(html: string) => Buffer>} The JavaScript `computeBodyHash`.
 */
async function loadJavaScriptBodyHash() {
	const stages = '../packages/@nitpicker/archive/src/body-hash/';
	const { extractBody } = await import(`${stages}extract-body.ts`);
	const { normalizeUrlLikeStrings } = await import(
		`${stages}normalize-url-like-strings.ts`
	);
	const { maskDynamicIds } = await import(`${stages}mask-dynamic-ids.ts`);
	return (html) =>
		computeContentHash(maskDynamicIds(normalizeUrlLikeStrings(extractBody(html))));
}

/** The implementation and its input decoder, per case in `BENCH_CASES['body-hash']`. */
const ENGINES = {
	rust: async () => ({ hash: computeBodyHash, decode: decodeStoredBlobBytes }),
	js: async () => ({ hash: await loadJavaScriptBodyHash(), decode: decodeStoredBlob }),
};
const loadEngine = ENGINES[caseName];
if (!loadEngine) {
	throw new Error(`bench-body-hash has no engine for case "${caseName}"`);
}
const { hash, decode } = await loadEngine();

await withReadOnlyArchive(archive, async (accessor) => {
	const knex = accessor.getKnex();
	let snapshots = 0;
	let bytes = 0;
	let decodeMs = 0;
	let timeMs = 0;
	for await (const blob of iterateHtmlBlobs(knex)) {
		const decoded = measureSyncMs(() => decode(blob.body, blob.codec));
		decodeMs += decoded.ms;
		const document = decoded.value;
		if (snapshots === 0) {
			hash(document);
		}
		bytes += typeof document === 'string' ? Buffer.byteLength(document) : document.length;
		timeMs += measureSyncMs(() => hash(document)).ms;
		snapshots++;
	}
	console.error(`hashed ${snapshots} snapshots`);
	await reportBenchResult({
		bench: 'body-hash',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(knex),
		timeMs,
		metrics: {
			snapshots,
			decodedBytes: bytes,
			decodeMs: Math.round(decodeMs),
			msPerSnapshot: snapshots === 0 ? 0 : Math.round((timeMs / snapshots) * 1000) / 1000,
		},
		json,
	});
});
