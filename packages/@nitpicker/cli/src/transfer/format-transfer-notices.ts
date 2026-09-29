import type { TransferOutcome } from './types.js';

/**
 * Formats the operator-facing notices for a finished `concat`/`split` run
 * — each one names a leftover follow-up action and the exact command to
 * run, in this fixed order: in-scope-but-external pages (concat only),
 * pending pages, dropped analyze plugin data, then a read-model build
 * failure. Every notice is independent (an empty condition contributes no
 * line), so the result can be empty (nothing to report).
 * @param outcome - See {@link TransferOutcome}.
 * @returns Zero or more single-line notices, in the order above.
 * @example
 * ```ts
 * for (const line of formatTransferNotices(outcome)) console.error(line);
 * ```
 */
export function formatTransferNotices(outcome: TransferOutcome): string[] {
	const lines: string[] = [];

	if (outcome.externalInScopeCount > 0 && !outcome.fromList) {
		const plural = outcome.externalInScopeCount === 1 ? '' : 's';
		lines.push(
			`${outcome.externalInScopeCount} URL${plural} inside the merged scope were only ever seen as external links and remain external. ` +
				`To fetch them as internal pages: npx @nitpicker/cli crawl ${outcome.outputPath} --append ${outcome.appendHintRoot}`,
		);
	}

	if (outcome.pendingCount > 0) {
		const plural = outcome.pendingCount === 1 ? '' : 's';
		const hint = outcome.fromList
			? 'no crawl mode can resume a list-mode (--list/--list-file) archive — this needs manual investigation.'
			: `npx @nitpicker/cli crawl ${outcome.outputPath} --append ${outcome.appendHintRoot}`;
		lines.push(
			`Warning: ${outcome.pendingCount} URL${plural} in the output archive are still pending (unexpected — please report this). ${hint}`,
		);
	}

	if (outcome.pluginDataEntries.length > 0) {
		lines.push(
			`Analyze plugin data was not carried over (${outcome.pluginDataEntries.join(', ')}). ` +
				`Re-run: npx @nitpicker/cli analyze ${outcome.outputPath}`,
		);
	}

	if (outcome.readModelError !== null) {
		lines.push(
			`Warning: viewer read model build failed (${outcome.readModelError}). ` +
				`Rebuild with: npx @nitpicker/cli viewer-build ${outcome.outputPath}`,
		);
	}

	return lines;
}
