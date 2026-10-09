import { describe, expect, it } from 'vitest';

import { compressPayload } from './compress-payload.js';
import { decodeJsonRef } from './decode-json-ref.js';

describe('compressPayload', () => {
	it('round-trips through decodeJsonRef back to the exact original bytes', () => {
		const original = '{"memberCount":3,"structuralCoreTokens":["a","b"]}';
		const { body, codec } = compressPayload(Buffer.from(original, 'utf8'));
		expect(decodeJsonRef(body, codec)).toBe(original);
	});

	it('always reports the zstd codec', () => {
		expect(compressPayload(Buffer.from('{}', 'utf8')).codec).toBe('zstd');
	});

	it('reports the raw and stored byte sizes', () => {
		const raw = Buffer.from('{"a":1}', 'utf8');
		const { sizeRaw, sizeStored, body } = compressPayload(raw);
		expect(sizeRaw).toBe(raw.byteLength);
		expect(sizeStored).toBe(body.byteLength);
	});
});
