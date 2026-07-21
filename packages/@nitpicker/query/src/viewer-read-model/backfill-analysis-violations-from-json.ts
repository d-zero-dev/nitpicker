import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Backfills `analysis_violations` from the legacy `analysis/violations.json`
 * payload when the SQL table is empty.
 *
 * This runs only during explicit viewer-read-model builds, never on read-only
 * open. Existing archives keep their JSON file intact; this helper only
 * populates the SQL tables so the read path can switch over.
 * @param accessor - Writable archive accessor.
 */
export async function backfillAnalysisViolationsFromJson(
	accessor: ArchiveAccessor,
): Promise<void> {
	const knex = accessor.getKnex();
	const [countRow] = await knex('analysis_violations')
		.count<{ count: string }[]>({ count: '*' })
		.limit(1);
	if (Number(countRow?.count ?? 0) > 0) {
		return;
	}

	let violations: unknown;
	try {
		violations = await accessor.getData('analysis/violations', 'json');
	} catch (error) {
		if (
			error instanceof Error &&
			'code' in error &&
			(error as NodeJS.ErrnoException).code === 'ENOENT'
		) {
			return;
		}
		throw error;
	}

	if (!Array.isArray(violations) || violations.length === 0) {
		return;
	}

	const archive = accessor as unknown as {
		replaceAnalysisViolations?: (violations: readonly unknown[]) => Promise<void>;
	};
	if (!archive.replaceAnalysisViolations) {
		throw new Error(
			'backfillAnalysisViolationsFromJson: archive does not support SQL backfill',
		);
	}
	await archive.replaceAnalysisViolations(
		violations as readonly {
			validator: string;
			severity: string;
			rule: string;
			code?: string | null;
			message: string;
			url: string;
			line?: number | null;
			col?: number | null;
		}[],
	);
}
