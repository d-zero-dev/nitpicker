import type { GetViolationsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Violation entry from analysis results stored in the archive.
 */
interface ViolationEntry {
	/** The page URL. */
	url: string;
	/** The validator that produced this violation. */
	validator: string;
	/** The severity level. */
	severity: string;
	/** The rule ID. */
	rule: string;
	/** The violation message. */
	message: string;
	/** The source code snippet or element selector. */
	code: string;
}

/**
 * Retrieves analysis violations stored in the archive.
 * Reads the `analysis/violations` data file written by `@nitpicker/core`
 * during the analyze phase. This is a single flat array of all violations
 * across all validators and pages.
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

	let rawViolations: ArchiveViolation[];
	try {
		rawViolations = await accessor.getData<ArchiveViolation[]>(
			'analysis/violations',
			'json',
		);
	} catch (error) {
		// analysis/violations not found — analyze has not been run yet
		if (
			error instanceof Error &&
			'code' in error &&
			(error as NodeJS.ErrnoException).code === 'ENOENT'
		) {
			return { items: [], total: 0 };
		}
		throw error;
	}

	if (!Array.isArray(rawViolations)) {
		return { items: [], total: 0 };
	}

	let filtered = rawViolations;

	if (options.validator) {
		filtered = filtered.filter((v) => v.validator === options.validator);
	}
	if (options.severity) {
		filtered = filtered.filter((v) => v.severity === options.severity);
	}
	if (options.rule) {
		filtered = filtered.filter((v) => v.rule === options.rule);
	}

	const total = filtered.length;
	const items: ViolationEntry[] = filtered.slice(offset, offset + limit).map((v) => ({
		url: v.url,
		validator: v.validator,
		severity: v.severity,
		rule: v.rule,
		message: v.message,
		code: v.code ?? '',
	}));

	return { items, total };
}

/**
 * Violation data structure as stored by `@nitpicker/core` in `analysis/violations`.
 * Mirrors the `Violation` interface from `@nitpicker/types`.
 */
interface ArchiveViolation {
	/** Name of the validator. */
	validator: string;
	/** Severity level. */
	severity: string;
	/** Rule identifier. */
	rule: string;
	/** Source code snippet or selector. */
	code?: string;
	/** Human-readable description. */
	message: string;
	/** Page URL. */
	url: string;
}
