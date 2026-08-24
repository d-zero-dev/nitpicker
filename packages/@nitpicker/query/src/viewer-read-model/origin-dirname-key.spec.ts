import { describe, expect, it } from 'vitest';

import { originDirnameKey } from './origin-dirname-key.js';

describe('originDirnameKey', () => {
	it('combines hostname, port, and dirname into one key', () => {
		expect(
			originDirnameKey({ hostname: 'example.com', port: '8080', dirname: '/blog' }),
		).toBe('example.com:8080/blog');
	});

	it('treats a null port as empty, distinct from an explicit port', () => {
		const withoutPort = originDirnameKey({
			hostname: 'example.com',
			port: null,
			dirname: '/blog',
		});
		const withEmptyStringPort = originDirnameKey({
			hostname: 'example.com',
			port: '',
			dirname: '/blog',
		});
		expect(withoutPort).toBe(withEmptyStringPort);
	});

	it('falls back to "/" for a null dirname (the site root)', () => {
		expect(originDirnameKey({ hostname: 'example.com', port: null, dirname: null })).toBe(
			'example.com:/',
		);
	});

	it('produces different keys for the same dirname on different hosts', () => {
		const a = originDirnameKey({
			hostname: 'site-a.example',
			port: null,
			dirname: '/blog',
		});
		const b = originDirnameKey({
			hostname: 'site-b.example',
			port: null,
			dirname: '/blog',
		});
		expect(a).not.toBe(b);
	});

	it('produces different keys for the same host/dirname on different ports', () => {
		const a = originDirnameKey({ hostname: 'example.com', port: '80', dirname: '/blog' });
		const b = originDirnameKey({
			hostname: 'example.com',
			port: '8080',
			dirname: '/blog',
		});
		expect(a).not.toBe(b);
	});
});
