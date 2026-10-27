import { describe, it, expect, vi } from 'vitest';

vi.mock('./native-binding.js', () => ({ nativeBinding: {} }));

describe('MAX_DECODED_SNAPSHOT_BYTES from an addon that does not export it', () => {
	it('fails the import instead of leaving the limit undefined', async () => {
		await expect(import('./max-decoded-snapshot-bytes.js')).rejects.toThrow(
			/exports no valid MAX_DECODED_SNAPSHOT_BYTES \(got undefined\)/,
		);
	});
});
