import { describe, it, expect } from 'vitest';

import { matchJsLicenseCommentSignal } from './match-js-license-comment-signal.js';

describe('matchJsLicenseCommentSignal', () => {
	it('detects Vue from its license banner', () => {
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

	it('returns null for a script without a banner', () => {
		expect(
			matchJsLicenseCommentSignal(Buffer.from('var a = "<div id=\\"app\\">";')),
		).toBeNull();
	});

	it('returns null for no bytes', () => {
		expect(matchJsLicenseCommentSignal(Buffer.alloc(0))).toBeNull();
	});

	it('reads a prefix cut inside a character', () => {
		const bytes = Buffer.concat([
			Buffer.from('/*! * Vue.js v2 '),
			Buffer.from([226, 128]), // the first two bytes of a three-byte UTF-8 sequence
		]);
		expect(matchJsLicenseCommentSignal(bytes)?.evidence).toBe('/*! * Vue.js v2');
	});
});
