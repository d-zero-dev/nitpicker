import { describe, it, expect } from 'vitest';

import { matchJsLicenseCommentSignal } from './match-js-license-comment-signal.js';

describe('matchJsLicenseCommentSignal', () => {
	it('returns the license banner signal with every field', () => {
		expect(
			matchJsLicenseCommentSignal(Buffer.from('/*!\n * Vue.js v3.4.21\n */\nvar a;')),
		).toEqual({
			technology: 'Vue',
			signalType: 'js-license-comment',
			evidence: '/*!\n * Vue.js v3',
			weight: 55,
			category: 'JavaScript frameworks',
		});
	});

	it('returns null when no banner matches', () => {
		expect(matchJsLicenseCommentSignal(Buffer.from('var a = 1;'))).toBeNull();
	});

	it('does not test the HTML fingerprints', () => {
		expect(
			matchJsLicenseCommentSignal(Buffer.from('"<div id=\\"app\\"> /_next/"')),
		).toBeNull();
	});

	it('reads bytes that are not valid UTF-8 without throwing', () => {
		const bytes = Buffer.concat([
			Buffer.from('/*! * Vue.js v2 '),
			Buffer.from([226, 128]), // the first two bytes of a three-byte UTF-8 sequence
		]);
		expect(matchJsLicenseCommentSignal(bytes)?.evidence).toBe('/*! * Vue.js v2');
	});

	it('throws an InvalidArg error instead of crashing on a non-binary argument', () => {
		expect(() =>
			matchJsLicenseCommentSignal('/*! Vue.js v3' as unknown as Uint8Array),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});
});
