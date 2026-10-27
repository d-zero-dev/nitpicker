import { describe, it, expect } from 'vitest';

import { MAX_DECODED_SNAPSHOT_BYTES } from './max-decoded-snapshot-bytes.js';

describe('MAX_DECODED_SNAPSHOT_BYTES', () => {
	it('is the most a stored snapshot can take: the longest V8 string at 3 UTF-8 bytes per code unit', () => {
		expect(MAX_DECODED_SNAPSHOT_BYTES).toBe(3 * (2 ** 29 - 24));
	});
});
