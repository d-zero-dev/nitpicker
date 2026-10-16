/**
 * Golden check of the isolated clusters, the alias backfill, the alias keys
 * and the link graph on a real archive, for corpora that cannot be
 * committed (dogfooding crawls).
 *
 *   node scripts/isolated-alias-golden.mjs dump <archive> <out.jsonl>
 *   node scripts/isolated-alias-golden.mjs check <archive> <golden.jsonl>
 *
 * Both modes run the production functions on a throwaway copy of the
 * archive, in the order viewer-build runs them (`backfillBodyHashFromHtmlBlobs`
 * → `backfillAliasOfId` → `computeIsolatedClusters` → `getLinkGraph`), and
 * record, as maps of strings:
 *
 * - `alias`: every `content_items.alias_of_id` as member URL → representative URL.
 * - `tierA` / `tierB`: the alias keys of every `url_refs.url` (`null` as `\u0000null`).
 * - `componentOrder`: the isolated components in the order the read model
 *   numbers them (position → representative URL); `componentMembers`: each
 *   one's members in the order the function returns them.
 * - `graphNodes` / `limitedNodes`: every link graph node as
 *   `status|inDegree|source`, for `getLinkGraph()` and
 *   `getLinkGraph({ limit: 500 })`; `graphEdges` / `limitedEdges`: the edge
 *   count and a SHA-256 over the sorted `source\ttarget` lines (the edge
 *   order is not defined, so the lines are sorted).
 *
 * The dump is one JSON line per entry (`[category, key, value]`), because the
 * alias keys of every URL of a large archive do not fit one JSON string.
 *
 * Take the dump from a build of the base branch (before the change under
 * test), and keep it **outside the repository** — it contains the crawled
 * URLs. `check` exits 1 on any difference, printing counts and the first few
 * differing entries (URLs included, so do not paste that output into issues),
 * and exits 2 when the comparison could not run at all.
 *
 * The source archive is never modified. Needs `yarn build` first.
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { computeTierAAliasKey } from '@nitpicker/archive/url-alias/compute-tier-a-alias-key';
import { computeTierBAliasKey } from '@nitpicker/archive/url-alias/compute-tier-b-alias-key';
import {
	backfillAliasOfId,
	backfillBodyHashFromHtmlBlobs,
	computeIsolatedClusters,
	getLinkGraph,
} from '@nitpicker/query';

import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';
import { listRecordDifferences } from './golden-lib/list-record-differences.mjs';

/** Differing entries printed per category by `check`. */
const SHOWN_DIFFERENCES = 5;

/** Stands for a `null` key. */
const NULL_KEY = '\u0000null';

const [mode, archivePath, goldenPath] = process.argv.slice(2);
if ((mode !== 'dump' && mode !== 'check') || !archivePath || !goldenPath) {
	process.stderr.write(
		'Usage: node scripts/isolated-alias-golden.mjs <dump|check> <archive> <golden.jsonl>\n',
	);
	process.exit(2);
}

/**
 * @param {string} a - A string.
 * @param {string} b - A string.
 * @returns {number} Code-unit order.
 */
function compareCodeUnits(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {{ nodes: { url: string; status: number | null; inDegree: number; source: string }[]; edges: { source: string; target: string }[] }} graph - A link graph.
 * @returns {{ nodes: Map<string, string>; edges: Map<string, string> }} Its order-free summary.
 */
function summarizeGraph(graph) {
	const hash = createHash('sha256');
	const lines = graph.edges
		.map((edge) => `${edge.source}\t${edge.target}`)
		.toSorted(compareCodeUnits);
	for (const line of lines) {
		hash.update(line);
		hash.update('\n');
	}
	return {
		nodes: new Map(
			graph.nodes.map((node) => [
				node.url,
				`${node.status ?? ''}|${node.inDegree}|${node.source}`,
			]),
		),
		edges: new Map([
			['count', String(lines.length)],
			['digest', hash.digest('hex')],
		]),
	};
}

/**
 * Runs the functions on a throwaway copy of the archive and reads back what
 * they produced.
 * @param {string} source - The `.nitpicker` file.
 * @returns {Promise<Map<string, Map<string, string>>>} Category → entries.
 */
function collect(source) {
	return withWritableArchiveCopy(source, async (archive) => {
		const knex = archive.getKnex();
		await backfillBodyHashFromHtmlBlobs(archive);
		await backfillAliasOfId(archive);

		const aliasRows = await knex('content_items as member')
			.join('url_refs as member_ur', 'member_ur.id', 'member.url_id')
			.join('content_items as rep', 'rep.id', 'member.alias_of_id')
			.join('url_refs as rep_ur', 'rep_ur.id', 'rep.url_id')
			.select('member_ur.url as member', 'rep_ur.url as representative');

		const urlRows = await knex('url_refs').select('url');
		const urls = urlRows.map((row) => row.url);

		const components = await computeIsolatedClusters(archive);
		const graph = summarizeGraph(await getLinkGraph(archive));
		const limited = summarizeGraph(await getLinkGraph(archive, { limit: 500 }));

		return new Map([
			['alias', new Map(aliasRows.map((row) => [row.member, row.representative]))],
			['tierA', new Map(urls.map((url) => [url, computeTierAAliasKey(url) ?? NULL_KEY]))],
			['tierB', new Map(urls.map((url) => [url, computeTierBAliasKey(url) ?? NULL_KEY]))],
			[
				'componentOrder',
				new Map(components.map((c, index) => [String(index), c.representativeUrl])),
			],
			[
				'componentMembers',
				new Map(
					components.map((c) => [
						c.representativeUrl,
						c.members.map((m) => m.url).join('\n'),
					]),
				),
			],
			['graphNodes', graph.nodes],
			['graphEdges', graph.edges],
			['limitedNodes', limited.nodes],
			['limitedEdges', limited.edges],
		]);
	});
}

/**
 * @param {string} file - Where to write.
 * @param {Map<string, Map<string, string>>} categories - What to write.
 * @returns {Promise<void>} Resolves when the file is flushed.
 */
async function writeDump(file, categories) {
	const out = createWriteStream(file);
	for (const [category, entries] of categories) {
		for (const [key, value] of entries) {
			if (!out.write(`${JSON.stringify([category, key, value])}\n`)) {
				await once(out, 'drain');
			}
		}
	}
	out.end();
	await once(out, 'finish');
}

/**
 * @param {string} file - A dump.
 * @returns {Promise<Map<string, Map<string, string>>>} Category → entries.
 */
async function readDump(file) {
	const categories = new Map();
	const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
	for await (const line of lines) {
		const [category, key, value] = JSON.parse(line);
		if (
			typeof category !== 'string' ||
			typeof key !== 'string' ||
			typeof value !== 'string'
		) {
			throw new TypeError(
				'Not an isolated-alias golden dump: every line must be [category, key, value]',
			);
		}
		if (!categories.has(category)) {
			categories.set(category, new Map());
		}
		categories.get(category).set(key, value);
	}
	return categories;
}

/**
 * @param {string} label - Category name for the report.
 * @param {Map<string, string>} expected - Golden entries.
 * @param {Map<string, string>} actual - Fresh entries.
 * @returns {number} How many keys differ (missing, extra or changed).
 */
function reportCategory(label, expected, actual) {
	const differing = listRecordDifferences(
		Object.fromEntries(expected),
		Object.fromEntries(actual),
	);
	process.stdout.write(
		`${label}: ${expected.size} expected, ${actual.size} actual, ${differing.length} differing\n`,
	);
	for (const key of differing.slice(0, SHOWN_DIFFERENCES)) {
		process.stdout.write(
			`  ${key}\n    expected: ${expected.get(key) ?? '(missing)'}\n    actual:   ${actual.get(key) ?? '(missing)'}\n`,
		);
	}
	return differing.length;
}

/**
 * Runs the requested mode.
 * @returns {Promise<number>} The exit code: 0 when `dump` succeeds or `check`
 *   finds no difference, 1 when `check` finds differences.
 */
async function run() {
	if (mode === 'dump') {
		const categories = await collect(archivePath);
		await writeDump(goldenPath, categories);
		process.stdout.write(
			`wrote ${[...categories].map(([name, entries]) => `${name}=${entries.size}`).join(' ')}\n`,
		);
		return 0;
	}
	const golden = await readDump(goldenPath);
	const result = await collect(archivePath);
	let differing = 0;
	for (const name of new Set([...golden.keys(), ...result.keys()])) {
		differing += reportCategory(
			name,
			golden.get(name) ?? new Map(),
			result.get(name) ?? new Map(),
		);
	}
	return differing === 0 ? 0 : 1;
}

// Exit 1 means "the output differs"; anything that kept the comparison
// from happening exits 2 like a usage error, so a caller never mistakes a
// crash for a difference.
try {
	process.exitCode = await run();
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exitCode = 2;
}
