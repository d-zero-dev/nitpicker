import { describe, it, expect } from 'vitest';

import { formatCrawlConsoleHelp } from './format-crawl-console-help.js';

describe('formatCrawlConsoleHelp', () => {
	it('lists every crawl-console command', () => {
		// A pure, fully deterministic single-line string — a hardcoded exact
		// match catches a broken separator, dropped/duplicated command, or
		// reordering that a per-command `toContain` loop would miss.
		expect(formatCrawlConsoleHelp()).toBe(
			'commands: parallels <n> | interval <ms> | exclude <glob...> | exclude-url <prefix...> | exclude-keyword <text> | help',
		);
	});
});
