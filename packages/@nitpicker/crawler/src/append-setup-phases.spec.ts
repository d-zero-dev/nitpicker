import { describe, expect, it } from 'vitest';

import { APPEND_SETUP_PHASES } from './append-setup-phases.js';

describe('APPEND_SETUP_PHASES', () => {
	it('lists the nine phases append() announces on its success path, in call order — guards against accidental drift', () => {
		// Order matters here (unlike a Set-based kind list): the CLI's setup
		// task list pre-builds one row per entry in this exact sequence.
		expect(APPEND_SETUP_PHASES).toEqual([
			'Extracting archive',
			'Loading archive config',
			'Backing up archive',
			'Repromoting external pages',
			'Loading dedupe-cap shape keys',
			'Loading crawl state',
			'Loading resource list',
			'Loading scraped page count',
			'Restoring crawl state',
		]);
	});
});
