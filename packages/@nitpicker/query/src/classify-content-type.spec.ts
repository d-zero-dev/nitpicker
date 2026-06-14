import { describe, it, expect } from 'vitest';

import { classifyContentType, CONTENT_TYPE_CATEGORIES } from './classify-content-type.js';

describe('classifyContentType', () => {
	it('returns "unknown" for null', () => {
		expect(classifyContentType(null)).toBe('unknown');
	});

	it('returns "unknown" for empty / whitespace', () => {
		expect(classifyContentType('')).toBe('unknown');
		expect(classifyContentType('   ')).toBe('unknown');
		expect(classifyContentType(';')).toBe('unknown');
	});

	it('classifies HTML', () => {
		expect(classifyContentType('text/html')).toBe('html');
		expect(classifyContentType('text/html; charset=utf-8')).toBe('html');
		expect(classifyContentType('Text/HTML;Charset=UTF-8')).toBe('html');
		expect(classifyContentType('application/xhtml+xml')).toBe('html');
	});

	it('classifies PDF', () => {
		expect(classifyContentType('application/pdf')).toBe('pdf');
		expect(classifyContentType('application/pdf; charset=binary')).toBe('pdf');
	});

	it('classifies image / audio / video / font wildcards', () => {
		expect(classifyContentType('image/png')).toBe('image');
		expect(classifyContentType('image/svg+xml')).toBe('image');
		expect(classifyContentType('audio/mpeg')).toBe('audio');
		expect(classifyContentType('video/mp4')).toBe('video');
		expect(classifyContentType('font/woff2')).toBe('font');
		expect(classifyContentType('application/font-woff')).toBe('font');
		expect(classifyContentType('application/vnd.ms-fontobject')).toBe('font');
	});

	it('classifies CSS', () => {
		expect(classifyContentType('text/css')).toBe('css');
	});

	it('classifies JavaScript variants', () => {
		expect(classifyContentType('text/javascript')).toBe('javascript');
		expect(classifyContentType('application/javascript')).toBe('javascript');
		expect(classifyContentType('application/x-javascript')).toBe('javascript');
		expect(classifyContentType('application/ecmascript')).toBe('javascript');
	});

	it('classifies JSON including +json suffix', () => {
		expect(classifyContentType('application/json')).toBe('json');
		expect(classifyContentType('application/ld+json')).toBe('json');
		expect(classifyContentType('application/vnd.api+json')).toBe('json');
	});

	it('classifies XML including +xml suffix', () => {
		expect(classifyContentType('application/xml')).toBe('xml');
		expect(classifyContentType('text/xml')).toBe('xml');
		expect(classifyContentType('application/atom+xml')).toBe('xml');
	});

	it('classifies archive / binary blobs', () => {
		expect(classifyContentType('application/zip')).toBe('archive');
		expect(classifyContentType('application/gzip')).toBe('archive');
		expect(classifyContentType('application/x-tar')).toBe('archive');
		expect(classifyContentType('application/x-7z-compressed')).toBe('archive');
		expect(classifyContentType('application/x-rar-compressed')).toBe('archive');
		expect(classifyContentType('application/octet-stream')).toBe('archive');
	});

	it('falls back to "text" for other text/*', () => {
		expect(classifyContentType('text/plain')).toBe('text');
		expect(classifyContentType('text/csv')).toBe('text');
	});

	it('falls back to "other" for unknown types', () => {
		expect(classifyContentType('application/vnd.example.unknown')).toBe('other');
		expect(classifyContentType('multipart/form-data')).toBe('other');
	});

	it('exposes a stable category list', () => {
		expect(CONTENT_TYPE_CATEGORIES).toContain('html');
		expect(CONTENT_TYPE_CATEGORIES).toContain('pdf');
		expect(CONTENT_TYPE_CATEGORIES.at(-1)).toBe('unknown');
		// すべての値が一意であること
		expect(new Set(CONTENT_TYPE_CATEGORIES).size).toBe(CONTENT_TYPE_CATEGORIES.length);
	});
});
