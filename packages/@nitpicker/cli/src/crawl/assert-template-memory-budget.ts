import { resolveTemplateMemoryBudget } from './resolve-template-memory-budget.js';

/**
 * Fails when the template classification's memory budget — the
 * `--template-memory-budget` flag, else `NITPICKER_TEMPLATE_MEMORY_BUDGET` —
 * is not a non-negative number of MiB.
 *
 * Called when a command starts, before any crawl or archive I/O:
 * classification is the last, never-throwing step of a command, so an
 * invalid value found there would only be reported after hours of crawling,
 * with an archive saved without templates.
 * @param flag - The `--template-memory-budget` flag, in MiB.
 * @throws {Error} When the value that applies is invalid.
 * @example
 * ```ts
 * assertTemplateMemoryBudget(flags.templateMemoryBudget);
 * ```
 */
export function assertTemplateMemoryBudget(flag?: number): void {
	resolveTemplateMemoryBudget({
		flag,
		env: process.env.NITPICKER_TEMPLATE_MEMORY_BUDGET,
	});
}
