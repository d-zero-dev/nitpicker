import { describe, expect, it } from 'vitest';

import { MigrationVerificationError } from './types.js';

describe('MigrationVerificationError', () => {
	it('renders the check identifier verbatim into the message', () => {
		const error = new MigrationVerificationError({ check: '#1 content_items row count' });
		expect(error.message).toBe(
			'migration verification failed #1 content_items row count',
		);
		expect(error.name).toBe('MigrationVerificationError');
	});

	it('renders numeric context values as decimal integers', () => {
		const error = new MigrationVerificationError({
			check: '#4 anchor_edges count sum',
			context: {
				sum_of_anchor_edges_count: 42,
				anchors: 43,
			},
		});
		expect(error.message).toBe(
			'migration verification failed #4 anchor_edges count sum — sum_of_anchor_edges_count=42, anchors=43',
		);
	});

	it('quotes string context values so " and " cannot corrupt the message', () => {
		const error = new MigrationVerificationError({
			check: '#7 content_type preservation',
			context: {
				sample_content_type: 'text/html; charset=utf-8',
			},
		});
		expect(error.message).toContain('sample_content_type="text/html; charset=utf-8"');
	});

	it('renders null as the literal `(null)` so it is distinguishable from the string "null"', () => {
		const errorFromNull = new MigrationVerificationError({
			check: '#7 content_type preservation',
			context: {
				sample_page_id: null,
				sample_content_type: null,
			},
		});
		expect(errorFromNull.message).toContain('sample_page_id=(null)');
		expect(errorFromNull.message).toContain('sample_content_type=(null)');

		const errorFromLiteralString = new MigrationVerificationError({
			check: '#7 content_type preservation',
			context: {
				sample_content_type: 'null',
			},
		});
		expect(errorFromLiteralString.message).toContain('sample_content_type="null"');
	});

	it('omits the context section entirely when no context is supplied', () => {
		const error = new MigrationVerificationError({ check: 'runtime' });
		expect(error.message).toBe('migration verification failed runtime');
	});

	it('exposes the raw details on the error instance', () => {
		const details = {
			check: '#8 URL round-trip',
			context: {
				page_id: 100,
				source_url: 'https://example.com/a',
				round_trip_url: 'https://example.com/b',
				sample_size: 500,
			},
		} as const;
		const error = new MigrationVerificationError(details);
		expect(error.details).toBe(details);
	});
});
