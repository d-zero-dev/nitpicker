import { describe, expect, it } from 'vitest';

import { RESUME_SETUP_PHASES } from './resume-setup-phases.js';

describe('RESUME_SETUP_PHASES', () => {
	it('lists the seven phases resume() announces, in call order — guards against accidental drift', () => {
		// Order matters here (unlike a Set-based kind list): the CLI's setup
		// task list pre-builds one row per entry in this exact sequence.
		expect(RESUME_SETUP_PHASES).toEqual([
			'Reconnecting to archive',
			'Loading archive config',
			'Loading dedupe-cap shape keys',
			'Loading crawl state',
			'Loading resource list',
			'Loading scraped page count',
			'Restoring crawl state',
		]);
	});
});
