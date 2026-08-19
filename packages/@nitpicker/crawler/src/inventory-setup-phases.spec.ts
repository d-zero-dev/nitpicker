import { describe, expect, it } from 'vitest';

import { INVENTORY_SETUP_PHASES } from './inventory-setup-phases.js';

describe('INVENTORY_SETUP_PHASES', () => {
	it('lists the twelve-phase superset sequence, in call order — guards against accidental drift', () => {
		// Order matters here (unlike a Set-based kind list): the CLI's setup
		// task list pre-builds one row per entry in this exact sequence and
		// marks whichever suffix a given run never reaches as skipped. Note
		// 'Loading crawl state' appears twice (indices 2 and 8) — the first
		// read is pre-ingestion, the second re-reads after new seeds are
		// inserted; both rows exist even though the label text is identical.
		expect(INVENTORY_SETUP_PHASES).toEqual([
			'Extracting archive',
			'Loading archive config',
			'Loading crawl state',
			'Checking for already-known URLs',
			'Backing up archive',
			'Recording non-HTML resources',
			'Recording HTML seed pages',
			'Recording excluded pages',
			'Loading crawl state',
			'Loading resource list',
			'Loading scraped page count',
			'Restoring crawl state',
		]);
	});
});
