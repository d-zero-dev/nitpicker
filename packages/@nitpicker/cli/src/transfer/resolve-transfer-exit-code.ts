import type { TransferOutcome } from './types.js';

import { ExitCode } from '../exit-code.js';

/**
 * Resolves the process exit code for a finished `concat`/`split` run, once
 * the archive has already been written successfully (a validation or
 * pipeline failure exits {@link ExitCode.Fatal} separately, before this is
 * ever called).
 *
 * `pendingCount > 0` is treated as a warning, not fatal, even though the
 * #350 invariant says "a `.nitpicker` file exists ⟹ pending is empty" —
 * pending is empty BY CONSTRUCTION for `concat`/`split` (every source
 * already satisfies the invariant, and the strict `getCrawlingState`
 * filters carry over unchanged), so a non-empty result here means an
 * unexpected anomaly rather than the normal in-progress state
 * `crawl --resume` leaves behind. Discarding a long transfer over that
 * anomaly would be worse than writing the archive with a warning — the
 * operator can inspect and re-run `--append`/`viewer-build` as needed.
 * @param outcome - See {@link TransferOutcome}.
 * @returns {@link ExitCode.Warning} if `pendingCount > 0` or the read
 *   model build failed; {@link ExitCode.Success} otherwise.
 * @example
 * ```ts
 * process.exitCode = resolveTransferExitCode(outcome);
 * ```
 */
export function resolveTransferExitCode(
	outcome: TransferOutcome,
): (typeof ExitCode)[keyof typeof ExitCode] {
	if (outcome.pendingCount > 0 || outcome.readModelError !== null) {
		return ExitCode.Warning;
	}
	return ExitCode.Success;
}
