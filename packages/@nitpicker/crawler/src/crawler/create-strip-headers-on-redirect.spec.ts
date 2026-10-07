import { describe, expect, it } from 'vitest';

import { createStripHeadersOnRedirect } from './create-strip-headers-on-redirect.js';

const inScope = (href: string) => href.startsWith('https://example.com/');

describe('createStripHeadersOnRedirect', () => {
	it('keeps the headers when the hop stays in scope', () => {
		const hook = createStripHeadersOnRedirect({
			headerNames: ['Authorization'],
			isInScope: inScope,
		});
		const options = {
			href: 'https://example.com/next',
			headers: { Authorization: 'Bearer t', Accept: '*/*' },
		};
		hook(options);
		expect(options.headers).toEqual({ Authorization: 'Bearer t', Accept: '*/*' });
	});

	it('drops only the configured headers (case-insensitive) when the hop leaves scope', () => {
		const hook = createStripHeadersOnRedirect({
			headerNames: ['Authorization', 'X-Api-Key'],
			isInScope: inScope,
		});
		const options = {
			href: 'https://other.example/next',
			headers: { authorization: 'Bearer t', 'x-api-key': 'k', Accept: '*/*' },
		};
		hook(options);
		expect(options.headers).toEqual({ Accept: '*/*' });
	});

	it('rebuilds the hop URL from its parts when href is absent', () => {
		const hook = createStripHeadersOnRedirect({
			headerNames: ['Authorization'],
			isInScope: inScope,
		});
		const stays = {
			protocol: 'https:',
			hostname: 'example.com',
			path: '/a',
			headers: { Authorization: 'x' },
		};
		hook(stays);
		expect(stays.headers).toEqual({ Authorization: 'x' });

		const leaves = {
			protocol: 'https:',
			hostname: 'example.com',
			port: '8443',
			path: '/a',
			headers: { Authorization: 'x' },
		};
		hook(leaves);
		expect(leaves.headers).toEqual({});
	});

	it('brackets an IPv6 hostname when rebuilding the hop URL so an in-scope hop is not misjudged external', () => {
		const hook = createStripHeadersOnRedirect({
			headerNames: ['Authorization'],
			isInScope: (href) => href === 'http://[::1]:3000/a',
		});
		const options = {
			protocol: 'http:',
			hostname: '::1',
			port: '3000',
			path: '/a',
			headers: { Authorization: 'x' },
		};
		hook(options);
		expect(options.headers).toEqual({ Authorization: 'x' });
	});

	it('fails closed when the hop URL cannot be determined', () => {
		const hook = createStripHeadersOnRedirect({
			headerNames: ['Authorization'],
			isInScope: () => true,
		});
		const options = { headers: { Authorization: 'x' } };
		hook(options);
		expect(options.headers).toEqual({});
	});

	it('does nothing when the hop has no headers object', () => {
		const hook = createStripHeadersOnRedirect({
			headerNames: ['Authorization'],
			isInScope: inScope,
		});
		expect(() => hook({ href: 'https://other.example/' })).not.toThrow();
	});
});
