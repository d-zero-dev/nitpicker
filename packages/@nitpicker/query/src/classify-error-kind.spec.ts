import { describe, it, expect } from 'vitest';

import { classifyErrorKind } from './classify-error-kind.js';

describe('classifyErrorKind', () => {
	it('classifies DNS resolution failures as dns', () => {
		expect(classifyErrorKind('getaddrinfo ENOTFOUND www.example.com')).toBe('dns');
		expect(classifyErrorKind('Error: getaddrinfo EAI_AGAIN example.com')).toBe('dns');
		expect(classifyErrorKind('net::ERR_NAME_NOT_RESOLVED at https://example.com')).toBe(
			'dns',
		);
	});

	it('classifies TLS/certificate failures as tls', () => {
		expect(classifyErrorKind('net::ERR_CERT_DATE_INVALID')).toBe('tls');
		expect(classifyErrorKind('Error: unable to verify the first certificate')).toBe(
			'tls',
		);
		expect(classifyErrorKind('net::ERR_SSL_PROTOCOL_ERROR')).toBe('tls');
	});

	it('classifies connection-refused as connection-refused', () => {
		expect(classifyErrorKind('connect ECONNREFUSED 127.0.0.1:443')).toBe(
			'connection-refused',
		);
		expect(classifyErrorKind('net::ERR_CONNECTION_REFUSED')).toBe('connection-refused');
	});

	it('classifies connection resets and empty responses as connection-reset', () => {
		expect(classifyErrorKind('read ECONNRESET')).toBe('connection-reset');
		expect(classifyErrorKind('Error: socket hang up')).toBe('connection-reset');
		expect(classifyErrorKind('net::ERR_EMPTY_RESPONSE')).toBe('connection-reset');
	});

	it('classifies transport-level timeouts as connection-timeout (not page timeout)', () => {
		expect(classifyErrorKind('connect ETIMEDOUT 93.184.216.34:443')).toBe(
			'connection-timeout',
		);
		expect(classifyErrorKind('net::ERR_CONNECTION_TIMED_OUT')).toBe('connection-timeout');
	});

	it('classifies puppeteer/page timeouts as timeout', () => {
		expect(
			classifyErrorKind(
				'Scraper.#fetchData: gave up after 3 retries — Race 180,000ms vs Scraper.#fetchData',
			),
		).toBe('timeout');
		expect(classifyErrorKind('Navigation timeout of 60000 ms exceeded')).toBe('timeout');
		expect(
			classifyErrorKind('TimeoutError: waiting failed: timeout 30000ms exceeded'),
		).toBe('timeout');
	});

	it('classifies puppeteer protocol/lifecycle failures as protocol', () => {
		expect(
			classifyErrorKind('Protocol error (DOM.describeNode): Cannot find context'),
		).toBe('protocol');
		expect(classifyErrorKind('Execution context was destroyed')).toBe('protocol');
		expect(classifyErrorKind('Protocol error (Page.reload): Target closed')).toBe(
			'protocol',
		);
		expect(classifyErrorKind('Navigating frame was detached')).toBe('protocol');
		expect(classifyErrorKind('The method Page.goto returned null')).toBe('protocol');
	});

	it('falls back to unknown when no matcher applies', () => {
		expect(classifyErrorKind('something completely unexpected happened')).toBe('unknown');
		expect(classifyErrorKind('')).toBe('unknown');
	});

	it('prefers the transport cause over the page-timeout bucket', () => {
		// A message carrying ETIMEDOUT must not be mislabelled as a page timeout.
		expect(classifyErrorKind('net::ERR_CONNECTION_TIMED_OUT, timeout exceeded')).toBe(
			'connection-timeout',
		);
	});
});
