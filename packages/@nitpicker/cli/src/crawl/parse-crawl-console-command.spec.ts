import { describe, it, expect } from 'vitest';

import { parseCrawlConsoleCommand } from './parse-crawl-console-command.js';

describe('parseCrawlConsoleCommand', () => {
	it('returns empty for a blank line', () => {
		expect(parseCrawlConsoleCommand('')).toEqual({ kind: 'empty' });
	});

	it('returns empty for a whitespace-only line', () => {
		expect(parseCrawlConsoleCommand('   \t  ')).toEqual({ kind: 'empty' });
	});

	it('returns help for "help"', () => {
		expect(parseCrawlConsoleCommand('help')).toEqual({ kind: 'help' });
	});

	it('returns help for "?"', () => {
		expect(parseCrawlConsoleCommand('?')).toEqual({ kind: 'help' });
	});

	it('parses "parallels <n>" into a patch', () => {
		expect(parseCrawlConsoleCommand('parallels 4')).toEqual({
			kind: 'patch',
			patch: { parallels: 4 },
			label: 'parallels 4',
		});
	});

	it('trims and collapses surrounding whitespace before parsing', () => {
		expect(parseCrawlConsoleCommand('  parallels   4  ')).toEqual({
			kind: 'patch',
			patch: { parallels: 4 },
			label: 'parallels 4',
		});
	});

	it('rejects "parallels" with no argument', () => {
		const result = parseCrawlConsoleCommand('parallels');
		expect(result.kind).toBe('error');
	});

	it('rejects "parallels" with a non-integer argument', () => {
		const result = parseCrawlConsoleCommand('parallels four');
		expect(result.kind).toBe('error');
	});

	it('parses "parallels -1" syntactically — range validation is CrawlerOrchestrator#updateRuntimeOptions\'s job', () => {
		// A negative value must reach `assertValidPatch`'s specific
		// `RangeError` ("parallels must be an integer >= 1, got -1") rather
		// than being rejected here with this file's generic
		// `usage: parallels <integer>` message.
		expect(parseCrawlConsoleCommand('parallels -1')).toEqual({
			kind: 'patch',
			patch: { parallels: -1 },
			label: 'parallels -1',
		});
	});

	it('rejects "parallels" with extra arguments', () => {
		const result = parseCrawlConsoleCommand('parallels 4 8');
		expect(result.kind).toBe('error');
	});

	it('parses "parallels 0" syntactically — range validation is CrawlerOrchestrator#updateRuntimeOptions\'s job', () => {
		expect(parseCrawlConsoleCommand('parallels 0')).toEqual({
			kind: 'patch',
			patch: { parallels: 0 },
			label: 'parallels 0',
		});
	});

	it('parses "interval <ms>" into a patch', () => {
		expect(parseCrawlConsoleCommand('interval 500')).toEqual({
			kind: 'patch',
			patch: { interval: 500 },
			label: 'interval 500',
		});
	});

	it('rejects "interval" with no argument', () => {
		expect(parseCrawlConsoleCommand('interval').kind).toBe('error');
	});

	it('parses "interval -5" syntactically — range validation is CrawlerOrchestrator#updateRuntimeOptions\'s job', () => {
		expect(parseCrawlConsoleCommand('interval -5')).toEqual({
			kind: 'patch',
			patch: { interval: -5 },
			label: 'interval -5',
		});
	});

	it('still rejects a bare "-" as a non-integer argument', () => {
		expect(parseCrawlConsoleCommand('interval -').kind).toBe('error');
	});

	it('parses "exclude <glob>" with one pattern', () => {
		expect(parseCrawlConsoleCommand('exclude /admin/**')).toEqual({
			kind: 'patch',
			patch: { excludes: ['/admin/**'] },
			label: 'exclude /admin/**',
		});
	});

	it('parses "exclude <glob> <glob>" with multiple space-separated patterns', () => {
		expect(parseCrawlConsoleCommand('exclude /admin/** /api/**')).toEqual({
			kind: 'patch',
			patch: { excludes: ['/admin/**', '/api/**'] },
			label: 'exclude /admin/** /api/**',
		});
	});

	it('rejects "exclude" with no argument', () => {
		expect(parseCrawlConsoleCommand('exclude').kind).toBe('error');
	});

	it('parses "exclude-url <prefix>" into a patch', () => {
		expect(parseCrawlConsoleCommand('exclude-url https://example.com/admin/')).toEqual({
			kind: 'patch',
			patch: { excludeUrls: ['https://example.com/admin/'] },
			label: 'exclude-url https://example.com/admin/',
		});
	});

	it('rejects "exclude-url" with no argument', () => {
		expect(parseCrawlConsoleCommand('exclude-url').kind).toBe('error');
	});

	it('parses "exclude-keyword <text>" joining the remainder as one keyword', () => {
		expect(parseCrawlConsoleCommand('exclude-keyword out of stock')).toEqual({
			kind: 'patch',
			patch: { excludeKeywords: ['out of stock'] },
			label: 'exclude-keyword out of stock',
		});
	});

	it('rejects "exclude-keyword" with no argument', () => {
		expect(parseCrawlConsoleCommand('exclude-keyword').kind).toBe('error');
	});

	it('rejects an unknown command', () => {
		const result = parseCrawlConsoleCommand('bogus 1');
		expect(result).toEqual({
			kind: 'error',
			message: 'unknown command: bogus (type "help" for a list)',
		});
	});
});
