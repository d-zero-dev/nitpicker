import type { TemplateMemoryBudgetSources } from './types.js';

const BYTES_PER_MIB = 1024 * 1024;

/**
 * The template classification's memory budget in bytes, from the
 * `--template-memory-budget <MiB>` flag, else the
 * `NITPICKER_TEMPLATE_MEMORY_BUDGET` environment variable (also MiB). The
 * flag wins so one invocation can override an environment set for the
 * session. Neither given — or the variable empty — means the default, which
 * `@nitpicker/core` owns (`TEMPLATE_MEMORY_BUDGET`), so it is `undefined`
 * here rather than a copy that could drift.
 *
 * `0` is valid: it samples every block, which clusters every block from a
 * sample of at most `TEMPLATE_BLOCK_SAMPLE_SIZE` pages and assigns the rest.
 * @param sources - See {@link TemplateMemoryBudgetSources}.
 * @returns Bytes (whole), or `undefined` for the default.
 * @throws {Error} When the value that applies is not a non-negative number.
 * @example
 * ```ts
 * resolveTemplateMemoryBudget({ flag: 512 }); // 536870912
 * resolveTemplateMemoryBudget({ env: '1.5' }); // 1572864
 * resolveTemplateMemoryBudget({}); // undefined
 * ```
 */
export function resolveTemplateMemoryBudget(
	sources: Partial<TemplateMemoryBudgetSources>,
): number | undefined {
	const { flag, env } = sources;
	const given =
		flag === undefined
			? env === undefined || env.trim() === ''
				? undefined
				: { value: Number(env), where: `NITPICKER_TEMPLATE_MEMORY_BUDGET="${env}"` }
			: { value: flag, where: `--template-memory-budget ${flag}` };
	if (given === undefined) {
		return undefined;
	}
	if (!Number.isFinite(given.value) || given.value < 0) {
		throw new Error(
			`Invalid template memory budget (${given.where}): expected a non-negative number of MiB`,
		);
	}
	return Math.floor(given.value * BYTES_PER_MIB);
}
