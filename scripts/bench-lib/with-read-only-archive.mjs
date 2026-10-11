/* eslint-disable import-x/no-extraneous-dependencies */

import path from 'node:path';

import { ArchiveManager } from '@nitpicker/query';

import { runThenClose } from './run-then-close.mjs';

/**
 * Opens an archive read-only the way the viewer, MCP server and `query`
 * CLI do (`ArchiveManager`: extracted once into the on-disk tar cache, never
 * modified), runs `work` on it, and closes it — for benches whose target
 * only reads.
 * @template T
 * @param {string} archivePath - The `.nitpicker` file.
 * @param {(accessor: import('@nitpicker/archive/archive-accessor').ArchiveAccessor) => Promise<T>} work
 *   The measurement.
 * @returns {Promise<T>} What `work` resolved to.
 * @example
 * const result = await withReadOnlyArchive(archivePath, (accessor) =>
 *   searchHtml(accessor, { pattern: '<div', limit: 0 }),
 * );
 */
export async function withReadOnlyArchive(archivePath, work) {
	const manager = new ArchiveManager();
	const opened = await manager.open(path.resolve(archivePath));
	return runThenClose(
		() => work(opened.accessor),
		() => manager.close(opened.archiveId),
	);
}
