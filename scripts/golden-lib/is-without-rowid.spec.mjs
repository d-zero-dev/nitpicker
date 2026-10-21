import { describe, it, expect } from 'vitest';

import { isWithoutRowid } from './is-without-rowid.mjs';

describe('isWithoutRowid', () => {
	it('is true for a table declared WITHOUT ROWID', () => {
		expect(
			isWithoutRowid(`CREATE TABLE t (
				a integer,
				b integer,
				primary key(a, b)
			) WITHOUT ROWID`),
		).toBe(true);
	});

	it('is false for an ordinary rowid table', () => {
		expect(isWithoutRowid('CREATE TABLE t (id integer primary key, name text)')).toBe(
			false,
		);
	});

	it('ignores any case and spacing in the clause', () => {
		expect(
			isWithoutRowid('CREATE TABLE t (a integer primary key)  without   rowid  '),
		).toBe(true);
	});

	it('ignores a trailing semicolon', () => {
		expect(isWithoutRowid('CREATE TABLE t (a integer primary key) WITHOUT ROWID;')).toBe(
			true,
		);
	});

	it('is not fooled by the words appearing in a column name or a default', () => {
		expect(
			isWithoutRowid('CREATE TABLE t (without_rowid integer, "WITHOUT ROWID" text)'),
		).toBe(false);
		expect(isWithoutRowid("CREATE TABLE t (note text default 'WITHOUT ROWID')")).toBe(
			false,
		);
	});

	it('is true when the table also carries other table options after the key list', () => {
		expect(
			isWithoutRowid('CREATE TABLE t (a integer primary key) WITHOUT ROWID, STRICT'),
		).toBe(true);
		expect(
			isWithoutRowid('CREATE TABLE t (a integer primary key) STRICT, WITHOUT ROWID'),
		).toBe(true);
	});

	it('is false for a missing statement', () => {
		expect(isWithoutRowid(null)).toBe(false);
		expect(isWithoutRowid()).toBe(false);
	});
});
