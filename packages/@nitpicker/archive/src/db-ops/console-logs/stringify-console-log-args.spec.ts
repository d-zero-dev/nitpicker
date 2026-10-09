import { describe, expect, it } from 'vitest';

import { stringifyConsoleLogArgs } from './stringify-console-log-args.js';

describe('stringifyConsoleLogArgs', () => {
	it('serializes a non-empty args array to JSON', () => {
		expect(stringifyConsoleLogArgs(['a', 1, { b: true }])).toBe('["a",1,{"b":true}]');
	});

	it('returns null for an empty array', () => {
		expect(stringifyConsoleLogArgs([])).toBeNull();
	});

	it('returns null when the array contains a circular reference', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(stringifyConsoleLogArgs([circular])).toBeNull();
	});
});
