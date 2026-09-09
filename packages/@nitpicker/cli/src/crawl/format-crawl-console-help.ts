/**
 * The status line shown in the crawl console after typing `help`/`?`.
 * @returns The list of available crawl-console commands, one line.
 * @example
 * ```ts
 * formatCrawlConsoleHelp();
 * // "commands: parallels <n> | interval <ms> | exclude <glob...> | exclude-url <prefix...> | exclude-keyword <text> | help"
 * ```
 */
export function formatCrawlConsoleHelp(): string {
	return 'commands: parallels <n> | interval <ms> | exclude <glob...> | exclude-url <prefix...> | exclude-keyword <text> | help';
}
