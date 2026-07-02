#!/usr/bin/env node
/**
 * Experimental sidecar build for the viewer read model (`viewer_pages` and
 * its sibling tables — see `packages/@nitpicker/query/src/viewer-read-model/`).
 *
 * This is NOT an archive-format migration: `.nitpicker`'s `info.version`
 * stays untouched. The viewer read model has its own independent version
 * (`VIEWER_READ_MODEL_SCHEMA_VERSION`), and this script is a stand-in for
 * the "explicit build command" path that issue #112 (persistent read-model
 * build timing) has not landed yet. Every read-only viewer/MCP/query CLI
 * open goes through `Archive.openCached` (never writable), so the read
 * model can only be built by re-opening the archive writably — exactly
 * what this script does, once, out of band.
 *
 * USAGE
 * -----
 *
 *     node scripts/migrate-viewer-read-model.mjs <archive.nitpicker> [--force]
 *
 * Without `--force`, the read model is only (re)built if missing or at a
 * stale schema version (`ensureViewerReadModel`, idempotent — a no-op on an
 * already-current archive). `--force` always rebuilds
 * (`buildViewerReadModel`), e.g. after a manual `viewer_pages` inspection.
 *
 * SAFETY
 * ------
 *
 * Mutates the archive IN PLACE, following the same `.bak`-then-restore
 * pattern `crawl --retry-failed` / `--append` use: a backup copy is made
 * before opening the archive writably, and restored automatically if
 * anything throws (a corrupt archive, a build failure, a full disk during
 * the re-tar). The backup is removed only after a fully successful
 * rebuild + write + close.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { existsSync } from 'node:fs';
import { copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel, ensureViewerReadModel } from '@nitpicker/query';

/**
 * Entry point. Parses argv, backs up the archive, builds/ensures the viewer
 * read model against a writable re-open, then writes the archive back.
 * Restores the pre-run backup on any failure.
 */
async function main() {
	const positional = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
	const force = process.argv.includes('--force');
	const inputArg = positional;
	if (!inputArg) {
		console.error(
			'Usage: node scripts/migrate-viewer-read-model.mjs <archive.nitpicker> [--force]',
		);
		process.exit(1);
	}

	const absPath = path.resolve(inputArg);
	if (!existsSync(absPath)) {
		console.error(`Input not found: ${absPath}`);
		process.exit(1);
	}

	const backupPath = `${absPath}.bak`;
	if (existsSync(backupPath)) {
		console.error(`Stale backup present: ${backupPath} — remove it first`);
		process.exit(1);
	}

	console.log(`[1/3] backing up ${absPath} -> ${backupPath}`);
	await copyFile(absPath, backupPath);

	try {
		console.log(
			`[2/3] ${force ? 'rebuilding (--force)' : 'ensuring current'} viewer read model`,
		);
		const archive = await Archive.open({ filePath: absPath, cwd: path.dirname(absPath) });
		if (force) {
			await buildViewerReadModel(archive);
		} else {
			await ensureViewerReadModel(archive);
		}
		console.log('[3/3] writing archive');
		await archive.write();
		await archive.close();

		await unlink(backupPath);
		console.log('Done.');
	} catch (error) {
		console.error('Migration failed — restoring from backup.');
		await copyFile(backupPath, absPath);
		await unlink(backupPath);
		throw error;
	}
}

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
