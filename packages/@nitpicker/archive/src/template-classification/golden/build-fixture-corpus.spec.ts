import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFixtureCorpus } from './build-fixture-corpus.js';

describe('buildFixtureCorpus', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'nitpicker-fixture-corpus-'));
		mkdirSync(path.join(dir, 'production-scale', 'cms'), { recursive: true });
		writeFileSync(path.join(dir, 'b.html'), '<p>b</p>');
		writeFileSync(path.join(dir, 'a.html'), '<p>a</p>');
		writeFileSync(path.join(dir, 'notes.txt'), 'not html');
		writeFileSync(path.join(dir, 'production-scale', 'cms', 'theme.html'), '<p>t</p>');
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('.html だけを相対パス順に読み、production-scale/ の段を paths から外す', () => {
		expect(buildFixtureCorpus(dir)).toEqual([
			{
				paths: ['a.html'],
				stylesheetHrefs: [],
				html: '<p>a</p>',
				host: 'golden.example',
			},
			{
				paths: ['b.html'],
				stylesheetHrefs: [],
				html: '<p>b</p>',
				host: 'golden.example',
			},
			{
				paths: ['cms', 'theme.html'],
				stylesheetHrefs: [],
				html: '<p>t</p>',
				host: 'golden.example',
			},
		]);
	});
});
