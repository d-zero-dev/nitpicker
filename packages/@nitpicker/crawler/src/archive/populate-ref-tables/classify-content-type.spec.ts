import { describe, it, expect } from 'vitest';

import { classifyContentType } from './classify-content-type.js';

describe('classifyContentType', () => {
	it('classifies HTML from an exact MIME', () => {
		expect(classifyContentType('text/html')).toBe('html');
		expect(classifyContentType('application/xhtml+xml')).toBe('html');
	});

	it('classifies xhtml+xml as html not xml (rule-order precedence)', () => {
		expect(classifyContentType('application/xhtml+xml')).toBe('html');
	});

	it('classifies image/svg+xml as image not xml (rule-order precedence)', () => {
		expect(classifyContentType('image/svg+xml')).toBe('image');
	});

	it('strips parameters before classifying', () => {
		expect(classifyContentType('text/html; charset=utf-8')).toBe('html');
		expect(classifyContentType('application/json; charset=utf-8')).toBe('json');
	});

	it('lower-cases before matching', () => {
		expect(classifyContentType('TEXT/HTML')).toBe('html');
		expect(classifyContentType('Application/JSON')).toBe('json');
	});

	it('classifies via prefix rules', () => {
		expect(classifyContentType('image/png')).toBe('image');
		expect(classifyContentType('image/webp')).toBe('image');
		expect(classifyContentType('audio/mpeg')).toBe('audio');
		expect(classifyContentType('video/mp4')).toBe('video');
		expect(classifyContentType('font/woff2')).toBe('font');
		expect(classifyContentType('application/font-woff')).toBe('font');
	});

	it('classifies via suffix rules', () => {
		expect(classifyContentType('application/ld+json')).toBe('json');
		expect(classifyContentType('application/atom+xml')).toBe('xml');
	});

	it('returns unknown for null / empty / blank', () => {
		expect(classifyContentType(null)).toBe('unknown');
		expect(classifyContentType('')).toBe('unknown');
		expect(classifyContentType('   ')).toBe('unknown');
		expect(classifyContentType(';charset=utf-8')).toBe('unknown');
	});

	it('returns other for unmatched MIMEs', () => {
		expect(classifyContentType('application/vnd.custom.thing')).toBe('other');
	});

	it('treats text/csv as csv not text (rule-order precedence)', () => {
		expect(classifyContentType('text/csv')).toBe('csv');
	});

	it('treats generic text/* as text (fall-through prefix rule)', () => {
		expect(classifyContentType('text/plain')).toBe('text');
	});
});
