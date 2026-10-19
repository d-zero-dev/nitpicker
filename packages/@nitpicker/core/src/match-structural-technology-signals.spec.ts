import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { matchStructuralTechnologySignals } from './match-structural-technology-signals.js';

interface GoldenCase {
	readonly name: string;
	readonly utf8Hex: string;
	readonly signals: readonly unknown[];
}

const golden = JSON.parse(
	readFileSync(
		new URL(
			'../crates/nitpicker_tech_detect/tests/fixtures/technology-signals-golden.json',
			import.meta.url,
		),
		'utf8',
	),
) as GoldenCase[];

describe('matchStructuralTechnologySignals', () => {
	it.each(golden.map((c) => [c.name, c] as const))(
		'matches the JavaScript golden signals: %s',
		(_name, goldenCase) => {
			expect(
				matchStructuralTechnologySignals(Buffer.from(goldenCase.utf8Hex, 'hex')),
			).toEqual(goldenCase.signals);
		},
	);

	it('returns every field of a matched fingerprint', () => {
		expect(
			matchStructuralTechnologySignals(Buffer.from('<div data-v-1a2b3c4d></div>')),
		).toEqual([
			{
				technology: 'Vue',
				signalType: 'scoped-attr',
				evidence: ' data-v-1a2b3c4d',
				weight: 40,
				category: 'JavaScript frameworks',
			},
		]);
	});

	it('returns an empty array for the empty input', () => {
		expect(matchStructuralTechnologySignals(Buffer.alloc(0))).toEqual([]);
	});

	it('throws an InvalidArg error instead of crashing on a non-binary argument', () => {
		expect(() =>
			matchStructuralTechnologySignals('<div id="app">' as unknown as Uint8Array),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});
});
