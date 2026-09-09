import type { CrawlConsoleCommandResult } from './types.js';
import type { CrawlRuntimeOptionsPatch } from '@nitpicker/crawler';

/**
 * Matches a decimal integer literal, negative sign optional — syntax only.
 * Range checking (`parallels >= 1`, `interval >= 0`) is `assertValidPatch`'s
 * job (`@nitpicker/crawler`'s `apply-crawl-runtime-options-patch.ts`), not
 * this parser's: accepting a negative value here and letting it fail there
 * instead of here is what surfaces that function's specific
 * `RangeError` message (`interval must be an integer >= 0, got -5`) through
 * the console rather than this file's generic `usage: ...` one.
 */
const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Parses one line typed into the crawl console into a runtime-options patch
 * or a `help`/`empty`/`error` result. Pure — does not touch the crawl itself;
 * `commands/crawl.ts` applies the returned patch via
 * `CrawlerOrchestrator#updateRuntimeOptions`, which does the actual
 * validation (integer ranges, non-empty exclude entries) and can still
 * throw on a value this parser accepted syntactically (e.g. `parallels 0`
 * parses fine here — it's a valid non-negative integer literal — but
 * `updateRuntimeOptions` rejects it as below the `>= 1` floor).
 * @param line - One line of raw input, not yet trimmed.
 * @returns The parsed command.
 * @example
 * ```ts
 * parseCrawlConsoleCommand('parallels 4');
 * // { kind: 'patch', patch: { parallels: 4 }, label: 'parallels 4' }
 * parseCrawlConsoleCommand('exclude /admin/** /api/**');
 * // { kind: 'patch', patch: { excludes: ['/admin/**', '/api/**'] }, label: 'exclude /admin/** /api/**' }
 * ```
 */
export function parseCrawlConsoleCommand(line: string): CrawlConsoleCommandResult {
	const trimmed = line.trim();
	if (trimmed === '') {
		return { kind: 'empty' };
	}

	const [name = '', ...rest] = trimmed.split(/\s+/);

	switch (name) {
		case 'help':
		case '?': {
			return { kind: 'help' };
		}
		case 'parallels': {
			return parseIntegerCommand({
				name,
				args: rest,
				toPatch: (value) => ({ parallels: value }),
			});
		}
		case 'interval': {
			return parseIntegerCommand({
				name,
				args: rest,
				toPatch: (value) => ({ interval: value }),
			});
		}
		case 'exclude': {
			return parseMultiValueCommand({
				name,
				args: rest,
				toPatch: (values) => ({ excludes: values }),
			});
		}
		case 'exclude-url': {
			return parseMultiValueCommand({
				name,
				args: rest,
				toPatch: (values) => ({ excludeUrls: values }),
			});
		}
		case 'exclude-keyword': {
			if (rest.length === 0) {
				return { kind: 'error', message: 'usage: exclude-keyword <text>' };
			}
			const keyword = rest.join(' ');
			return {
				kind: 'patch',
				patch: { excludeKeywords: [keyword] },
				label: `exclude-keyword ${keyword}`,
			};
		}
		default: {
			return {
				kind: 'error',
				message: `unknown command: ${name} (type "help" for a list)`,
			};
		}
	}
}

/** Parameters for {@link parseIntegerCommand}. */
interface ParseIntegerCommandParams {
	/** The command name, for the error message and the result `label`. */
	readonly name: string;
	/** The arguments after the command name. */
	readonly args: readonly string[];
	/** Builds the patch object from the parsed integer. */
	readonly toPatch: (value: number) => CrawlRuntimeOptionsPatch;
}

/**
 * Shared parsing for the `parallels`/`interval` commands: exactly one
 * decimal-integer argument.
 * @param params - See {@link ParseIntegerCommandParams}.
 * @param params.name
 * @param params.args
 * @param params.toPatch
 * @returns A `'patch'` result on success, `'error'` otherwise.
 */
function parseIntegerCommand({
	name,
	args,
	toPatch,
}: ParseIntegerCommandParams): CrawlConsoleCommandResult {
	const [value] = args;
	if (args.length !== 1 || value === undefined || !INTEGER_PATTERN.test(value)) {
		return { kind: 'error', message: `usage: ${name} <integer>` };
	}
	return { kind: 'patch', patch: toPatch(Number(value)), label: `${name} ${value}` };
}

/** Parameters for {@link parseMultiValueCommand}. */
interface ParseMultiValueCommandParams {
	/** The command name, for the error message and the result `label`. */
	readonly name: string;
	/** The arguments after the command name. */
	readonly args: readonly string[];
	/** Builds the patch object from the parsed argument list. */
	readonly toPatch: (values: readonly string[]) => CrawlRuntimeOptionsPatch;
}

/**
 * Shared parsing for the `exclude`/`exclude-url` commands: one or more
 * space-separated arguments (globs/prefixes never contain whitespace).
 * @param params - See {@link ParseMultiValueCommandParams}.
 * @param params.name
 * @param params.args
 * @param params.toPatch
 * @returns A `'patch'` result on success, `'error'` otherwise.
 */
function parseMultiValueCommand({
	name,
	args,
	toPatch,
}: ParseMultiValueCommandParams): CrawlConsoleCommandResult {
	if (args.length === 0) {
		return { kind: 'error', message: `usage: ${name} <value> [<value>...]` };
	}
	return { kind: 'patch', patch: toPatch(args), label: `${name} ${args.join(' ')}` };
}
