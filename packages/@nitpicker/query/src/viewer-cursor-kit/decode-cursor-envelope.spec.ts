import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeCursorEnvelope } from './decode-cursor-envelope.js';
import { encodeCursorEnvelope } from './encode-cursor-envelope.js';

const EXPECTED = {
	filterKey: '{"isExternal":false}',
	sortBy: 'url' as const,
	sortOrder: 'asc' as const,
	expectedValueCount: 2,
};

describe('decodeCursorEnvelope', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeCursorEnvelope({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a.css', 1],
		});
		expect(decodeCursorEnvelope(cursor, EXPECTED, '/api/resources')).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a.css', 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() =>
			decodeCursorEnvelope('%%%not-base64%%%', EXPECTED, '/api/resources'),
		).toThrow(/not decodable/);
	});

	it('throws on a decodable but malformed payload', () => {
		const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString(
			'base64url',
		);
		expect(() => decodeCursorEnvelope(cursor, EXPECTED, '/api/resources')).toThrow(
			/malformed/,
		);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeCursorEnvelope({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...EXPECTED,
			values: ['https://example.com/a.css', 1],
		});
		expect(() => decodeCursorEnvelope(cursor, EXPECTED, '/api/resources')).toThrow(
			/[Ss]tale/,
		);
	});

	it('throws on a cursor minted under a different filter', () => {
		const cursor = encodeCursorEnvelope({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			filterKey: '{"isExternal":true}',
			values: ['https://example.com/a.css', 1],
		});
		expect(() => decodeCursorEnvelope(cursor, EXPECTED, '/api/resources')).toThrow(
			/does not match/,
		);
	});

	it('throws on a cursor minted under a different sort', () => {
		const cursor = encodeCursorEnvelope({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			sortBy: 'status',
			values: [200, 'https://example.com/a.css', 1],
		});
		expect(() => decodeCursorEnvelope(cursor, EXPECTED, '/api/resources')).toThrow(
			/does not match/,
		);
	});

	it('throws on a values array whose length does not match expectedValueCount', () => {
		const cursor = encodeCursorEnvelope({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a.css'],
		});
		expect(() => decodeCursorEnvelope(cursor, EXPECTED, '/api/resources')).toThrow(
			/keyset value count/,
		);
	});

	it('includes the entityLabel in error messages', () => {
		expect(() =>
			decodeCursorEnvelope('%%%not-base64%%%', EXPECTED, '/api/widgets'),
		).toThrow(/\/api\/widgets/);
	});

	it('applies an optional per-position type check when supplied', () => {
		const expectedWithTypes = {
			...EXPECTED,
			expectedValueTypeAt: (index: number) => (index === 0 ? 'string' : 'number'),
		};
		const validCursor = encodeCursorEnvelope({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a.css', 1],
		});
		expect(() =>
			decodeCursorEnvelope(validCursor, expectedWithTypes, '/api/resources'),
		).not.toThrow();

		const invalidCursor = encodeCursorEnvelope({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: [123, 1],
		});
		expect(() =>
			decodeCursorEnvelope(invalidCursor, expectedWithTypes, '/api/resources'),
		).toThrow(/must be a string/);
	});
});
