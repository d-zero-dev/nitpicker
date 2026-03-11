import type { GetViolationsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Violation entry from analysis results stored in the archive.
 */
interface ViolationEntry {
	/** The page URL. */
	pageUrl: string;
	/** The validator that produced this violation. */
	validator: string;
	/** The severity level. */
	severity: string;
	/** The rule ID. */
	rule: string;
	/** The violation message. */
	message: string;
	/** The line number in the source. */
	line: number | null;
	/** The column number in the source. */
	col: number | null;
}

/**
 * Retrieves analysis violations stored in the archive.
 * Reads violation data from the archive's custom data storage (JSON files).
 * Supports filtering by validator, severity, and rule.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns A list of violation entries with total count.
 */
export async function getViolations(
	accessor: ArchiveAccessor,
	options: GetViolationsOptions = {},
): Promise<{ items: ViolationEntry[]; total: number }> {
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	// Analysis results are stored as JSON files in the archive under plugin namespaces.
	// We scan for known validator data files.
	const validators = ['axe', 'markuplint', 'textlint', 'lighthouse'];
	const allViolations: ViolationEntry[] = [];

	for (const validator of validators) {
		if (options.validator && options.validator !== validator) {
			continue;
		}

		try {
			const knex = accessor.getKnex();
			const pages = await knex('pages')
				.select('id', 'url')
				.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
				.whereNull('redirectDestId');

			for (const page of pages) {
				try {
					const data = await accessor.getData<ViolationData[]>(`${page.id}`, 'json');
					if (!Array.isArray(data)) {
						continue;
					}
					for (const item of data) {
						const entry: ViolationEntry = {
							pageUrl: page.url,
							validator,
							severity: item.severity ?? 'warning',
							rule: item.rule ?? item.ruleId ?? '',
							message: item.message ?? '',
							line: item.line ?? null,
							col: item.col ?? item.column ?? null,
						};

						if (options.severity && entry.severity !== options.severity) {
							continue;
						}
						if (options.rule && entry.rule !== options.rule) {
							continue;
						}

						allViolations.push(entry);
					}
				} catch {
					// Data file not found for this page/validator combination
				}
			}
		} catch {
			// Validator data not available
		}
	}

	const total = allViolations.length;
	const items = allViolations.slice(offset, offset + limit);

	return { items, total };
}

/**
 * Raw violation data structure as stored by analysis plugins.
 */
interface ViolationData {
	/** Severity level. */
	severity?: string;
	/** Rule identifier. */
	rule?: string;
	/** Alternative rule identifier used by some validators. */
	ruleId?: string;
	/** Violation message. */
	message?: string;
	/** Line number in source. */
	line?: number;
	/** Column number in source. */
	col?: number;
	/** Alternative column field used by some validators. */
	column?: number;
}
