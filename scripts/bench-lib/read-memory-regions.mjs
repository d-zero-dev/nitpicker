import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { parseProcStatusRss } from './parse-proc-status-rss.mjs';
import { parseVmmapSummary } from './parse-vmmap-summary.mjs';

/**
 * Reads where the process's resident memory is, by region type, from the OS:
 * `vmmap --summary` on macOS ({@link parseVmmapSummary}) and
 * `/proc/self/status` on Linux ({@link parseProcStatusRss}). RSS says how much;
 * this says whether it is `malloc`ed memory (V8's heap, SQLite's page cache,
 * row buffers), the database file mapped by `PRAGMA mmap_size`, or WAL shared
 * memory — the question a memory reduction has to answer before choosing what
 * to change.
 *
 * Synchronous so it can run from a phase callback that is not awaited. On
 * macOS `vmmap` suspends the process for the snapshot and takes about a
 * second, so it is for phase boundaries, not progress ticks. A platform
 * this cannot read gives `null`; a reader that fails (no `vmmap`, no
 * permission, output the parser does not understand) also gives `null` and
 * hands the error to `onError`, so a bench can say why rather than fail.
 * @param {{
 *   platform?: NodeJS.Platform;
 *   pid?: number;
 *   runVmmap?: (pid: number) => string;
 *   readProcStatus?: () => string;
 *   onError?: (error: unknown) => void;
 * }} [options] - The platform and process to read (default: this process),
 *   the readers (default: the real `vmmap` and `/proc/self/status`), and
 *   where a reader's failure goes (default: dropped).
 * @returns {{
 *   physicalFootprintBytes: number | null;
 *   regions: Record<string, { virtualBytes?: number; residentBytes: number; dirtyBytes?: number }>;
 * } | null} The footprint and region type → sizes, or `null` when unavailable.
 * @example
 * const regions = readMemoryRegions({ onError: (error) => console.error(error) });
 * regions?.regions['mapped file']?.residentBytes;
 */
export function readMemoryRegions(options = {}) {
	const {
		platform = process.platform,
		pid = process.pid,
		runVmmap = (targetPid) =>
			execFileSync('vmmap', ['--summary', String(targetPid)], {
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024,
			}),
		readProcStatus = () => readFileSync('/proc/self/status', 'utf8'),
		onError = () => {},
	} = options;
	try {
		switch (platform) {
			case 'darwin': {
				return parseVmmapSummary(runVmmap(pid));
			}
			case 'linux': {
				return parseProcStatusRss(readProcStatus());
			}
			default: {
				return null;
			}
		}
	} catch (error) {
		onError(error);
		return null;
	}
}
