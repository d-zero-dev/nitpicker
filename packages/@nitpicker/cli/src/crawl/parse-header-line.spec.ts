import { describe, expect, it } from 'vitest';

import { parseHeaderLine } from './parse-header-line.js';

describe('parseHeaderLine', () => {
	it('splits at the first colon and trims both sides', () => {
		expect(parseHeaderLine('Authorization:   Bearer abc  ')).toEqual({
			name: 'Authorization',
			value: 'Bearer abc',
		});
	});

	it('keeps colons inside the value', () => {
		expect(parseHeaderLine('X-Time: 12:30:00')).toEqual({
			name: 'X-Time',
			value: '12:30:00',
		});
	});

	it('rejects a line without a colon', () => {
		expect(() => parseHeaderLine('Authorization Bearer abc')).toThrow(
			'expected "Name: value"',
		);
	});

	it('rejects an empty name', () => {
		expect(() => parseHeaderLine(': value')).toThrow('expected "Name: value"');
	});

	it('rejects a name that is not an RFC 7230 token', () => {
		expect(() => parseHeaderLine('Bad Name: v')).toThrow('Invalid header name');
		expect(() => parseHeaderLine('Bad(Name): v')).toThrow('Invalid header name');
	});

	it('rejects an empty value', () => {
		expect(() => parseHeaderLine('X-Api-Key:   ')).toThrow('must not be empty');
	});

	it.each([
		['CR/LF', 'X-A: a\r\nX-B: b'],
		['NUL', 'X-A: a\0b'],
		['another control character', 'X-A: a\u0001b'],
		['a non-Latin-1 character', 'X-A: \u65E5\u672C\u8A9E'],
	])('rejects %s in the value', (_label, line) => {
		expect(() => parseHeaderLine(line)).toThrow('characters HTTP does not allow');
	});

	it('accepts a tab, printable ASCII and Latin-1 in the value', () => {
		expect(parseHeaderLine('X-A: a\tb ~ \u00E9')).toEqual({
			name: 'X-A',
			value: 'a\tb ~ \u00E9',
		});
	});

	it.each(['Host', 'content-length', 'Transfer-Encoding', 'Connection'])(
		'rejects the reserved header %s',
		(name) => {
			expect(() => parseHeaderLine(`${name}: x`)).toThrow('cannot be set');
		},
	);

	it('points User-Agent at --user-agent', () => {
		expect(() => parseHeaderLine('User-Agent: x')).toThrow('--user-agent');
	});

	it.each([
		['a reserved name', 'Host: super-secret-token'],
		['a mistyped name part', 'X-Token=super-secret:rest'],
		['a missing colon', 'Authorization Bearer super-secret-token'],
		['an empty value', 'X-Token-super-secret:'],
		['a bad value', 'X-A: super-secret\r\nX-B: token'],
	])('does not echo secret-looking content in the error for %s', (_label, line) => {
		let message = '';
		try {
			parseHeaderLine(line);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).not.toBe('');
		expect(message).not.toContain('super-secret');
	});
});
