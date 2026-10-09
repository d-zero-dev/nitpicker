import type { HeaderEntry } from './types.js';

import { describe, it, expect } from 'vitest';

import { computeHeaderFlags } from './compute-header-flags.js';

/**
 * Builds a `HeaderEntry` shaped for the tests below. Volatility defaults
 * to `false` — flag detection does not depend on it, only on the name.
 * @param name - Lower-cased header name.
 * @param value - Header value.
 * @returns Entry with `occurrence=1` and `isVolatile=false`.
 */
function entry(name: string, value: string): HeaderEntry {
	return { name, value, occurrence: 1, isVolatile: false };
}

describe('computeHeaderFlags (header-flags-computation)', () => {
	it('returns all zeros and null cache_policy for an empty set', () => {
		const flags = computeHeaderFlags([]);
		expect(flags).toEqual({
			has_csp: 0,
			has_x_frame_options: 0,
			has_x_content_type_options: 0,
			has_hsts: 0,
			has_referrer_policy: 0,
			has_permissions_policy: 0,
			has_set_cookie: 0,
			cache_policy: null,
		});
	});

	it('detects content-security-policy', () => {
		const flags = computeHeaderFlags([
			entry('content-security-policy', "default-src 'self'"),
		]);
		expect(flags.has_csp).toBe(1);
	});

	it('detects x-frame-options', () => {
		expect(
			computeHeaderFlags([entry('x-frame-options', 'DENY')]).has_x_frame_options,
		).toBe(1);
	});

	it('detects x-content-type-options', () => {
		expect(
			computeHeaderFlags([entry('x-content-type-options', 'nosniff')])
				.has_x_content_type_options,
		).toBe(1);
	});

	it('detects strict-transport-security', () => {
		expect(
			computeHeaderFlags([entry('strict-transport-security', 'max-age=31536000')])
				.has_hsts,
		).toBe(1);
	});

	it('detects referrer-policy', () => {
		expect(
			computeHeaderFlags([entry('referrer-policy', 'no-referrer')]).has_referrer_policy,
		).toBe(1);
	});

	it('detects permissions-policy', () => {
		expect(
			computeHeaderFlags([entry('permissions-policy', 'geolocation=()')])
				.has_permissions_policy,
		).toBe(1);
	});

	it('detects set-cookie', () => {
		expect(computeHeaderFlags([entry('set-cookie', 'session=abc')]).has_set_cookie).toBe(
			1,
		);
	});

	it('captures cache_policy value', () => {
		expect(computeHeaderFlags([entry('cache-control', 'no-store')]).cache_policy).toBe(
			'no-store',
		);
	});

	it('joins multi-value cache-control entries', () => {
		const flags = computeHeaderFlags([
			{ name: 'cache-control', value: 'no-store', occurrence: 1, isVolatile: false },
			{ name: 'cache-control', value: 'no-cache', occurrence: 2, isVolatile: false },
		]);
		expect(flags.cache_policy).toBe('no-store, no-cache');
	});

	it('does not false-positive on values that mention header names', () => {
		// A referrer-policy value whose text is "content-security-policy" must
		// NOT fire has_csp — the flag is computed from names (dict keys), not
		// substring scans across values.
		const flags = computeHeaderFlags([
			entry('referrer-policy', 'content-security-policy'),
		]);
		expect(flags.has_csp).toBe(0);
		expect(flags.has_referrer_policy).toBe(1);
	});

	it('detects a full security-headers bundle in one pass', () => {
		const flags = computeHeaderFlags([
			entry('content-security-policy', "default-src 'self'"),
			entry('x-frame-options', 'DENY'),
			entry('x-content-type-options', 'nosniff'),
			entry('strict-transport-security', 'max-age=31536000'),
			entry('referrer-policy', 'no-referrer'),
			entry('permissions-policy', 'geolocation=()'),
			entry('set-cookie', 'session=abc'),
			entry('cache-control', 'no-store'),
		]);
		expect(flags).toEqual({
			has_csp: 1,
			has_x_frame_options: 1,
			has_x_content_type_options: 1,
			has_hsts: 1,
			has_referrer_policy: 1,
			has_permissions_policy: 1,
			has_set_cookie: 1,
			cache_policy: 'no-store',
		});
	});
});
