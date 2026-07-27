#!/usr/bin/env node
/**
 * Rebuilds the viewer read model for a `.nitpicker` archive built before the
 * network-outage failure-attribution axis existed (read model schema
 * version < 20, bumped when `viewer_error_kind_entries` gained an
 * `attribution` column — its primary key widened from `(host, kind)` to
 * `(host, kind, attribution)` — and `viewer_summary` gained
 * `network_outage_affected_failures`). No archive write-model change
 * accompanies this bump — only `VIEWER_READ_MODEL_SCHEMA_VERSION` moved —
 * so this is a plain rebuild via `buildViewerReadModel`, not a data
 * migration in the `migrate-to-0.13.mjs` sense (no entity/ref table work,
 * no legacy-table drop).
 *
 * Recorded here as the one-line-runnable fix for this specific schema bump,
 * the same way `migrate-to-0.10.mjs` / `migrate-to-0.13.mjs` /
 * `migrate-to-0.14.mjs` record theirs.
 *
 * USAGE
 * -----
 *
 *     node scripts/migrate-to-0.15.mjs <old.nitpicker> [<new.nitpicker>]
 *
 * If <new.nitpicker> is omitted, writes to `<old>.0.15.nitpicker` next to
 * the input. Mirrors `migrate-to-0.14.mjs`'s own contract: the input file
 * is never touched — the rebuild runs against a copy at the output path,
 * so a failed run leaves nothing behind except that (removable) copy, and
 * the input doubles as the rollback artefact with no separate `.bak` step.
 *
 * Runs a `VACUUM` after rebuilding — `buildViewerReadModel` drops and
 * recreates every `viewer_*` table, but SQLite never shrinks `db.sqlite`
 * on its own after a `DROP TABLE`, so without this the old read model's
 * on-disk pages stay allocated underneath the freshly rebuilt one and the
 * file only grows across repeated rebuilds.
 *
 * NOT SHIPPED IN NPM
 * ------------------
 *
 * This script is not part of the `@nitpicker/*` npm bundles; use it via
 * `git clone` + `yarn build`.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { existsSync } from 'node:fs';
import { copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';

/**
 * Reports a progress line to stdout, indented like `migrate-to-0.14.mjs`'s
 * `logProgress` — a large archive's rebuild runs for a while with no other
 * output, so a silent script would look hung.
 * @param {string} message
 */
function logProgress(message) {
	console.log(`  ${message}`);
}

/**
 * Await a filesystem promise but silently swallow only `ENOENT` errors. Any
 * other failure (permissions, disk full, etc.) propagates.
 * @param {Promise<unknown>} promise
 */
async function ignoreEnoent(promise) {
	try {
		await promise;
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
}

/**
 * Entry point.
 */
async function main() {
	const [inputArg, outputArg] = process.argv.slice(2);
	if (!inputArg) {
		console.error(
			'Usage: node scripts/migrate-to-0.15.mjs <old.nitpicker> [<new.nitpicker>]',
		);
		process.exit(1);
	}
	const inputPath = path.resolve(inputArg);
	if (!existsSync(inputPath)) {
		console.error(`Input not found: ${inputPath}`);
		process.exit(1);
	}
	const outputPath = path.resolve(
		outputArg ??
			path.join(
				path.dirname(inputPath),
				`${path.basename(inputPath, path.extname(inputPath))}.0.15.nitpicker`,
			),
	);
	if (existsSync(outputPath)) {
		console.error(`Output already exists: ${outputPath} — remove it first`);
		process.exit(1);
	}

	try {
		console.log(`[1/4] copy ${inputPath} -> ${outputPath}`);
		await copyFile(inputPath, outputPath);

		console.log(`[2/4] rebuild viewer read model: ${outputPath}`);
		const archive = await Archive.open({ filePath: outputPath });
		try {
			await buildViewerReadModel(archive, {
				onProgress: (progress) => {
					logProgress(
						`viewer read model: ${progress.insertedRows}/${progress.totalRows} rows`,
					);
				},
			});
			console.log(
				'[3/4] vacuum database (reclaim space from the dropped/rebuilt tables)',
			);
			await archive.getKnex().raw('VACUUM');
			console.log(`[4/4] write -> ${outputPath}`);
			await archive.write();
		} finally {
			await archive.close();
		}
		console.log(`Done: ${outputPath}`);
	} catch (error) {
		// The input file was never touched — only the output-path copy this
		// run created is in a possibly half-built state, so cleaning that up
		// (rather than restoring from a backup) is enough.
		await ignoreEnoent(unlink(outputPath));
		throw error;
	}
}

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
