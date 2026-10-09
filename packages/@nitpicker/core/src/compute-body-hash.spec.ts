import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { computeBodyHash } from './compute-body-hash.js';

interface GoldenCase {
	readonly name: string;
	readonly utf8Hex: string;
	readonly hash: string;
}

const golden = JSON.parse(
	readFileSync(
		new URL(
			'../crates/nitpicker_html_scan/tests/fixtures/body-hash-golden.json',
			import.meta.url,
		),
		'utf8',
	),
) as GoldenCase[];

describe('computeBodyHash', () => {
	it.each(golden.map((c) => [c.name, c] as const))(
		'matches the JavaScript golden hash: %s',
		(_name, goldenCase) => {
			const hash = computeBodyHash(Buffer.from(goldenCase.utf8Hex, 'hex'));
			expect(hash.toString('hex')).toBe(goldenCase.hash);
		},
	);

	it('returns a 32-byte Buffer', () => {
		const hash = computeBodyHash(Buffer.from('<body>x</body>'));
		expect(hash).toBeInstanceOf(Buffer);
		expect(hash.byteLength).toBe(32);
	});

	it('accepts a plain Uint8Array', () => {
		const bytes = new TextEncoder().encode('<body>x</body>');
		expect(
			computeBodyHash(bytes).equals(computeBodyHash(Buffer.from('<body>x</body>'))),
		).toBe(true);
	});

	it('hashes the empty input as SHA-256 of nothing', () => {
		expect(computeBodyHash(Buffer.alloc(0)).toString('hex')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('throws an InvalidArg error instead of crashing on a non-binary argument', () => {
		expect(() => computeBodyHash('<body>x</body>' as unknown as Uint8Array)).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
	});
});
