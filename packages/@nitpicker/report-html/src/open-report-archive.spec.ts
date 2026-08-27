import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openReportArchive } from './open-report-archive.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_open_report_archive__');

describe('openReportArchive', () => {
	beforeAll(() => {
		mkdirSync(workingDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('rejects a directory that is not a completed archive', async () => {
		await expect(openReportArchive(workingDir)).rejects.toThrow(/Nitpicker/);
	});
});
