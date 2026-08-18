import { describe, it, expect } from 'vitest';

import { parsePaxPath } from './parse-pax-path.js';

describe('parsePaxPath', () => {
	it('extracts the path value (real node-tar PAX output for a UTF-8 name)', () => {
		// Captured verbatim from `tar.create()` tarring a directory named
		// "日本語ホスト名-テスト" — real PAX records emitted by this
		// codebase's own tar producer, not a hand-crafted approximation.
		const data = Buffer.from(
			'41 path=日本語ホスト名-テスト/\n' +
				'24 ctime=1787043464.522\n' +
				'24 atime=1787043464.521\n' +
				'8 gid=0\n' +
				'9 size=0\n' +
				'11 uid=501\n',
			'utf8',
		);
		expect(parsePaxPath(data)).toBe('日本語ホスト名-テスト/');
	});

	it('finds path when it is not the first record', () => {
		const data = Buffer.from('8 gid=0\n18 path=some/dir/\n', 'utf8');
		expect(parsePaxPath(data)).toBe('some/dir/');
	});

	it('returns null when no path record is present', () => {
		const data = Buffer.from('8 gid=0\n9 uid=501\n', 'utf8');
		expect(parsePaxPath(data)).toBeNull();
	});

	it('returns null for empty input', () => {
		expect(parsePaxPath(Buffer.alloc(0))).toBeNull();
	});

	it('returns null when a record length is malformed', () => {
		expect(parsePaxPath(Buffer.from('not-a-number path=x\n', 'utf8'))).toBeNull();
	});

	it('returns null when a record length overruns the buffer', () => {
		expect(parsePaxPath(Buffer.from('999 path=x\n', 'utf8'))).toBeNull();
	});
});
