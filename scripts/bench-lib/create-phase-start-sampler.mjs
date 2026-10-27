import { readMemoryRegions } from './read-memory-regions.mjs';
import { readWalBytes } from './read-wal-bytes.mjs';

/**
 * Records, per named moment of a build (each phase's start, and `final`
 * after it), the archive's WAL size and — when asked — the process's memory
 * by region type ({@link readMemoryRegions}). The first time the regions
 * cannot be read, `warn` is told why, once: the report would otherwise just
 * carry `null` per phase with nothing to say what went wrong.
 * @param {{
 *   tmpDir: string;
 *   regions: boolean;
 *   warn?: (message: string) => void;
 *   readRegions?: (options: { onError: (error: unknown) => void }) => ReturnType<typeof readMemoryRegions>;
 *   readWal?: (tmpDir: string) => number;
 * }} options - The archive's extracted directory, whether to sample regions,
 *   where the one warning goes (default: stderr), and the readers (default:
 *   the real ones).
 * @returns {{
 *   sample: (name: string) => void;
 *   walBytesAtPhaseStart: Record<string, number>;
 *   memoryRegionsAtPhaseStart: Record<string, ReturnType<typeof readMemoryRegions>>;
 * }} The sampler and the two records it fills.
 * @example
 * const sampler = createPhaseStartSampler({ tmpDir: archive.tmpDir, regions: true });
 * await buildViewerReadModel(archive, { onPhase: (phase) => sampler.sample(phase) });
 * sampler.sample('final');
 */
export function createPhaseStartSampler({
	tmpDir,
	regions,
	warn = (message) => process.stderr.write(`${message}\n`),
	readRegions = readMemoryRegions,
	readWal = readWalBytes,
}) {
	const walBytesAtPhaseStart = {};
	const memoryRegionsAtPhaseStart = {};
	let warned = false;
	const warnOnce = (message) => {
		if (!warned) {
			warned = true;
			warn(message);
		}
	};
	return {
		sample(name) {
			walBytesAtPhaseStart[name] = readWal(tmpDir);
			if (!regions) {
				return;
			}
			const sample = readRegions({
				onError: (error) => {
					warnOnce(
						`--regions: the memory regions could not be read: ${error instanceof Error ? error.message : String(error)}; recording null`,
					);
				},
			});
			if (sample === null) {
				warnOnce(
					`--regions: the memory regions cannot be read on ${process.platform} ` +
						'(needs `vmmap` on macOS or `/proc/self/status` on Linux); recording null',
				);
			}
			memoryRegionsAtPhaseStart[name] = sample;
		},
		walBytesAtPhaseStart,
		memoryRegionsAtPhaseStart,
	};
}
