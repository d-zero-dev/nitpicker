import { describe, expect, it } from 'vitest';

import { computeConsoleLogHash } from './compute-console-log-hash.js';

describe('computeConsoleLogHash', () => {
	it('produces identical hashes for identical content', () => {
		const a = computeConsoleLogHash({ type: 'error', text: 'boom', argsJson: null });
		const b = computeConsoleLogHash({ type: 'error', text: 'boom', argsJson: null });
		expect(a.equals(b)).toBe(true);
	});

	it('produces different hashes when text differs', () => {
		const a = computeConsoleLogHash({ type: 'error', text: 'boom', argsJson: null });
		const b = computeConsoleLogHash({ type: 'error', text: 'bang', argsJson: null });
		expect(a.equals(b)).toBe(false);
	});

	it('produces different hashes when type differs', () => {
		const a = computeConsoleLogHash({ type: 'error', text: 'boom', argsJson: null });
		const b = computeConsoleLogHash({ type: 'warn', text: 'boom', argsJson: null });
		expect(a.equals(b)).toBe(false);
	});

	it('produces different hashes when argsJson differs', () => {
		const a = computeConsoleLogHash({ type: 'log', text: 'x', argsJson: '[1]' });
		const b = computeConsoleLogHash({ type: 'log', text: 'x', argsJson: '[2]' });
		expect(a.equals(b)).toBe(false);
	});

	it('treats argsJson: null the same regardless of why the caller decided there was nothing to store', () => {
		// Whether the caller's args array was empty or failed to
		// JSON.stringify (e.g. a circular reference), both collapse to
		// `argsJson: null` before reaching this function — see
		// `stringifyConsoleLogArgs`'s own tests for that normalization.
		const a = computeConsoleLogHash({ type: 'log', text: 'x', argsJson: null });
		const b = computeConsoleLogHash({ type: 'log', text: 'x', argsJson: null });
		expect(a.equals(b)).toBe(true);
	});

	it('produces different hashes when location differs', () => {
		const a = computeConsoleLogHash({
			type: 'error',
			text: 'boom',
			argsJson: null,
			location: { url: 'https://example.com/a.js', lineNumber: 1, columnNumber: 2 },
		});
		const b = computeConsoleLogHash({
			type: 'error',
			text: 'boom',
			argsJson: null,
			location: { url: 'https://example.com/a.js', lineNumber: 2, columnNumber: 2 },
		});
		expect(a.equals(b)).toBe(false);
	});

	it('produces different hashes when stack differs', () => {
		const a = computeConsoleLogHash({
			type: 'pageerror',
			text: 'boom',
			argsJson: null,
			stack: 'Error: boom\n at a.js:1',
		});
		const b = computeConsoleLogHash({
			type: 'pageerror',
			text: 'boom',
			argsJson: null,
			stack: 'Error: boom\n at b.js:1',
		});
		expect(a.equals(b)).toBe(false);
	});

	it('returns a 32-byte SHA-256 buffer', () => {
		const hash = computeConsoleLogHash({ type: 'log', text: 'x', argsJson: null });
		expect(hash.byteLength).toBe(32);
	});
});
