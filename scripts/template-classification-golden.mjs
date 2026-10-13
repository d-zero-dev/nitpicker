/**
 * Golden check of the template classifier on a real archive, for corpora
 * that cannot be committed (dogfooding crawls). The committed golden test
 * (`archive/src/template-classification/golden/`) covers synthetic sites
 * and the bundled HTML fixtures, handed to the engine directly; this runs
 * the whole production path on real sites, locally.
 *
 *   node scripts/template-classification-golden.mjs dump <archive> <out.json>
 *   node scripts/template-classification-golden.mjs check <archive> <golden.json>
 *
 * `dump` runs the production entry point (`classifyArchivePageTemplates`,
 * with a progress callback as the CLI passes one) on a throwaway copy of the
 * archive and writes what it stored: every `page_templates` row (as URL →
 * template key) and every `page_template_clusters` reason as its
 * decompressed JSON text. Take dumps with an implementation you trust,
 * before changing the classifier, and keep them **outside the repository**
 * — they contain the crawled URLs. `check` reruns the classification and
 * exits 1 on any difference, printing counts and the first few differing
 * entries (URLs included, so do not paste that output into issues), and
 * exits 2 when the comparison could not run at all.
 *
 * The copy's previous classification is cleared first, and the run fails
 * unless every classified page was stored, so neither a run that classified
 * nothing (which leaves the tables untouched) nor pages that
 * `replacePageTemplates` could not map back to a row can pass unnoticed.
 *
 * The source archive is never modified. Needs `yarn build` first.
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { readFile, writeFile } from 'node:fs/promises';

import { classifyArchivePageTemplates } from '@nitpicker/archive/template-classification/classify-archive-page-templates';

import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';
import { decodeStoredReason } from './golden-lib/decode-stored-reason.mjs';
import { listRecordDifferences } from './golden-lib/list-record-differences.mjs';
import { parseGoldenDump } from './golden-lib/parse-golden-dump.mjs';
import { sortedRecord } from './golden-lib/sorted-record.mjs';

/** Differing entries printed per category by `check`. */
const SHOWN_DIFFERENCES = 5;

const [mode, archivePath, goldenPath] = process.argv.slice(2);
if ((mode !== 'dump' && mode !== 'check') || !archivePath || !goldenPath) {
	process.stderr.write(
		'Usage: node scripts/template-classification-golden.mjs <dump|check> <archive> <golden.json>\n',
	);
	process.exit(2);
}

/**
 * Classifies a throwaway copy of the archive and reads back what was stored.
 * @param {string} source - The `.nitpicker` file.
 * @returns {Promise<{ node: string; classifiedPageCount: number; templateKeyByUrl: Record<string, string>; clusterReasonJsonByTemplateKey: Record<string, string> }>}
 *   The dump; both maps with keys in code-unit order.
 */
function classify(source) {
	return withWritableArchiveCopy(source, async (archive) => {
		const knex = archive.getKnex();
		await knex('page_templates').delete();
		await knex('page_template_clusters').delete();

		const { classifiedPageCount } = await classifyArchivePageTemplates(archive, {
			onProgress: () => {},
		});

		const pageRows = await knex('page_templates as pt')
			.join('content_items as ci', 'ci.id', 'pt.page_id')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ur.url as url', 'pt.template_key as templateKey');
		if (classifiedPageCount === 0 || pageRows.length !== classifiedPageCount) {
			throw new Error(
				`Classified ${classifiedPageCount} pages but stored ${pageRows.length}; nothing to compare.`,
			);
		}
		const reasonRows = await knex('page_template_clusters').select(
			'template_key as templateKey',
			'reason_json as body',
			'codec',
		);
		return {
			node: process.version,
			classifiedPageCount,
			templateKeyByUrl: sortedRecord(pageRows.map((row) => [row.url, row.templateKey])),
			clusterReasonJsonByTemplateKey: sortedRecord(
				reasonRows.map((row) => [
					row.templateKey,
					decodeStoredReason(row.body, row.codec),
				]),
			),
		};
	});
}

/**
 * @param {string} label - Category name for the report.
 * @param {Record<string, string>} expected - Golden map.
 * @param {Record<string, string>} actual - Fresh map.
 * @returns {number} How many keys differ (missing, extra or changed).
 */
function reportDifferences(label, expected, actual) {
	const differing = listRecordDifferences(expected, actual);
	process.stdout.write(
		`${label}: ${Object.keys(expected).length} expected, ${Object.keys(actual).length} actual, ${differing.length} differing\n`,
	);
	for (const key of differing.slice(0, SHOWN_DIFFERENCES)) {
		process.stdout.write(
			`  ${key}\n    expected: ${expected[key] ?? '(missing)'}\n    actual:   ${actual[key] ?? '(missing)'}\n`,
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
		const result = await classify(archivePath);
		await writeFile(goldenPath, `${JSON.stringify(result, null, '\t')}\n`);
		process.stdout.write(
			`wrote ${result.classifiedPageCount} pages and ${Object.keys(result.clusterReasonJsonByTemplateKey).length} reasons\n`,
		);
		return 0;
	}
	const golden = parseGoldenDump(await readFile(goldenPath, 'utf8'));
	if (golden.node !== process.version) {
		process.stdout.write(
			`note: the golden was taken on Node ${golden.node ?? '(unknown)'}, this is ${process.version}\n`,
		);
	}
	const result = await classify(archivePath);
	const differing =
		reportDifferences('pages', golden.templateKeyByUrl, result.templateKeyByUrl) +
		reportDifferences(
			'reasons',
			golden.clusterReasonJsonByTemplateKey,
			result.clusterReasonJsonByTemplateKey,
		);
	return differing === 0 ? 0 : 1;
}

// Exit 1 means "the output differs"; anything that kept the comparison
// from happening (unreadable golden, failed classification) exits 2 like a
// usage error, so a caller never mistakes a crash for a difference.
try {
	process.exitCode = await run();
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exitCode = 2;
}
