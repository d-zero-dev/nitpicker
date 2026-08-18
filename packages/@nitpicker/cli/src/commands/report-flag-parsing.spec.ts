import { parseCli } from '@d-zero/roar';
import { describe, expect, it } from 'vitest';

import { commandDef as pipelineDef } from './pipeline-def.js';
import { commandDef as reportDef } from './report-def.js';

/**
 * Run `parseCli` against a fabricated `process.argv` for the `report`
 * command and return the parsed result. Restores `process.argv` after
 * the call so tests stay isolated.
 * @param argv - Args from the user's perspective (no `node ...cli.js` prefix).
 * @returns The `RoarResult` produced by `parseCli`.
 */
function runReportParse(argv: string[]) {
	const original = process.argv;
	process.argv = ['node', 'cli.js', 'report', ...argv];
	try {
		return parseCli({
			name: 'nitpicker',
			version: '0.13.0',
			commands: { report: reportDef },
			onError: () => true,
		});
	} finally {
		process.argv = original;
	}
}

/**
 * Run `parseCli` against a fabricated `process.argv` for the `pipeline`
 * command and return the parsed result.
 * @param argv - Args from the user's perspective.
 */
function runPipelineParse(argv: string[]) {
	const original = process.argv;
	process.argv = ['node', 'cli.js', 'pipeline', ...argv];
	try {
		return parseCli({
			name: 'nitpicker',
			version: '0.13.0',
			commands: { pipeline: pipelineDef },
			onError: () => true,
		});
	} finally {
		process.argv = original;
	}
}

describe('report CLI flag parsing (parseCli integration)', () => {
	it('interprets --dedupe-resources as true', () => {
		const result = runReportParse([
			'./archive.nitpicker',
			'-S',
			'https://docs.google.com/spreadsheets/d/x',
			'--dedupe-resources',
		]);
		expect(result.command).toBe('report');
		expect(result.flags.dedupeResources).toBe(true);
	});

	it('leaves dedupeResources undefined when the flag is omitted', () => {
		const result = runReportParse([
			'./archive.nitpicker',
			'-S',
			'https://docs.google.com/spreadsheets/d/x',
		]);
		expect(result.flags.dedupeResources).toBeUndefined();
	});

	it('keeps other flags untouched when --dedupe-resources is set', () => {
		const result = runReportParse([
			'./archive.nitpicker',
			'-S',
			'https://docs.google.com/spreadsheets/d/x',
			'--dedupe-resources',
			'--all',
			'-l',
			'5000',
		]);
		expect(result.flags.dedupeResources).toBe(true);
		expect(result.flags.all).toBe(true);
		expect(result.flags.limit).toBe(5000);
	});
});

describe('pipeline CLI flag parsing (parseCli integration)', () => {
	it('interprets --dedupe-resources as true', () => {
		const result = runPipelineParse([
			'https://example.com/',
			'-S',
			'https://docs.google.com/spreadsheets/d/x',
			'--dedupe-resources',
		]);
		expect(result.command).toBe('pipeline');
		expect(result.flags.dedupeResources).toBe(true);
	});

	it('leaves dedupeResources undefined when the flag is omitted', () => {
		const result = runPipelineParse([
			'https://example.com/',
			'-S',
			'https://docs.google.com/spreadsheets/d/x',
		]);
		expect(result.flags.dedupeResources).toBeUndefined();
	});
});
