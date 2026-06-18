import { describe, it, expect } from 'vitest';

import { classifyErrorKind } from '../classify-error-kind.js';

import { PreloadShortCircuitError } from './preload-short-circuit-error.js';

describe('PreloadShortCircuitError', () => {
	it('extends Error', () => {
		const error = new PreloadShortCircuitError('foo.invalid');
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(PreloadShortCircuitError);
	});

	it('embeds the hostname in the message in ENOTFOUND form', () => {
		const error = new PreloadShortCircuitError('foo.invalid');
		expect(error.message).toBe('getaddrinfo ENOTFOUND foo.invalid');
	});

	it('exposes isPreloadShortCircuit as a sniffable boolean flag', () => {
		const error = new PreloadShortCircuitError('foo.invalid');
		expect(error.isPreloadShortCircuit).toBe(true);
	});

	it('sets a descriptive name for logs', () => {
		const error = new PreloadShortCircuitError('foo.invalid');
		expect(error.name).toBe('PreloadShortCircuitError');
	});

	it('classifies as dns via classifyErrorKind so downstream log forwarders agree', () => {
		const error = new PreloadShortCircuitError('foo.invalid');
		expect(classifyErrorKind(error.message)).toBe('dns');
	});
});
