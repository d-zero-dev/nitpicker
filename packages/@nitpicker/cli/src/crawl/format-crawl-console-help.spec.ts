import { describe, it, expect } from 'vitest';

import { formatCrawlConsoleHelp } from './format-crawl-console-help.js';

describe('formatCrawlConsoleHelp', () => {
	it('lists every crawl-console command', () => {
		const help = formatCrawlConsoleHelp();
		for (const command of [
			'parallels',
			'interval',
			'exclude',
			'exclude-url',
			'exclude-keyword',
			'help',
		]) {
			expect(help).toContain(command);
		}
	});
});
