import type { ErrorKind } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { getErrorKindLabel } from './get-error-kind-label.js';

/**
 * Build a stub translate fn that returns whatever `dictionary` maps to and
 * falls back to the key itself when missing — mirroring the real `t()`.
 * @param dictionary - key → label mapping.
 * @returns A translate function compatible with {@link getErrorKindLabel}.
 */
function tStub(dictionary: Record<string, string>) {
	return (key: string) => dictionary[key] ?? key;
}

describe('getErrorKindLabel', () => {
	it('looks up the localised label via `views.errorKind.<kind>`', () => {
		const t = tStub({
			'views.errorKind.dns': 'DNS',
			'views.errorKind.connection-timeout': '接続タイムアウト',
		});
		expect(getErrorKindLabel('dns', t)).toBe('DNS');
		expect(getErrorKindLabel('connection-timeout', t)).toBe('接続タイムアウト');
	});

	it('falls back to the raw kind when no translation is registered', () => {
		const t = tStub({});
		expect(getErrorKindLabel('dns', t)).toBe('dns');
	});

	it('covers every kind in the ErrorKind union', () => {
		const kinds: ErrorKind[] = [
			'dns',
			'dns-transient',
			'connection-refused',
			'connection-reset',
			'connection-timeout',
			'tls',
			'local-network',
			'parse-error',
			'client-blocked',
			'timeout',
			'protocol',
			'unknown',
		];
		// The stub returns the key untouched so the label is the kind itself; the
		// assertion is that the helper does not throw for any union member.
		const t = tStub({});
		for (const kind of kinds) {
			expect(getErrorKindLabel(kind, t)).toBe(kind);
		}
	});
});
