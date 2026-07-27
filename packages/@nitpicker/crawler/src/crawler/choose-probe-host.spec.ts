import { describe, it, expect } from 'vitest';

import { chooseProbeHost } from './choose-probe-host.js';

describe('chooseProbeHost', () => {
	it('prefers a successful host over a root URL', () => {
		const result = chooseProbeHost(new Set(['a.example']), ['https://b.example/']);
		expect(result).toBe('a.example');
	});

	it('deterministically picks the first successful host (Set insertion order)', () => {
		const result = chooseProbeHost(new Set(['a.example', 'b.example']), []);
		expect(result).toBe('a.example');
	});

	it('falls back to the first root URL hostname when no host has succeeded yet', () => {
		const result = chooseProbeHost(new Set(), ['https://b.example/path']);
		expect(result).toBe('b.example');
	});

	it('skips a malformed root URL and falls through to the next one', () => {
		const result = chooseProbeHost(new Set(), ['not-a-url', 'https://c.example/']);
		expect(result).toBe('c.example');
	});

	it('returns null when there are no successful hosts and no parseable roots', () => {
		expect(chooseProbeHost(new Set(), [])).toBeNull();
		expect(chooseProbeHost(new Set(), ['not-a-url'])).toBeNull();
	});

	it('never falls back to a hardcoded external address', () => {
		// Regression guard for the design constraint: an empty successful-hosts
		// set with no roots must return null, not some baked-in host.
		const result = chooseProbeHost(new Set(), []);
		expect(result).toBeNull();
		expect(result).not.toBe('1.1.1.1');
	});
});
