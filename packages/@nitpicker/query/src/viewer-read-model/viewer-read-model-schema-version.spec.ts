import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

describe('VIEWER_READ_MODEL_SCHEMA_VERSION', () => {
	it('is a positive integer', () => {
		expect(Number.isInteger(VIEWER_READ_MODEL_SCHEMA_VERSION)).toBe(true);
		expect(VIEWER_READ_MODEL_SCHEMA_VERSION).toBeGreaterThan(0);
	});
});
