import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Archive from '@nitpicker/archive/archive';
import { computeBodyHash } from '@nitpicker/archive/body-hash/compute-body-hash';
import { decodeStoredBlob } from '@nitpicker/archive/decode-html-blob';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Committed archive whose `page_meta.body_hash` values were written by the
 * JavaScript `computeBodyHash`, before the computation moved into the native
 * addon. See `fixtures/README.md`.
 */
const FIXTURE = path.resolve(
	import.meta.dirname,
	'fixtures/report-query-fixture.nitpicker',
);

describe('body_hash stored by the JavaScript implementation (e2e)', () => {
	let cwd: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-body-hash-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('recomputes to the same value for every page with a stored HTML snapshot', async () => {
		// Opened from a copy so nothing touches the committed fixture.
		const filePath = path.join(cwd, 'fixture.nitpicker');
		await fs.copyFile(FIXTURE, filePath);
		const archive = await Archive.open({ filePath, cwd });
		try {
			const rows = (await archive
				.getKnex()('page_meta as pm')
				.join('page_html_ref as phr', 'phr.page_id', 'pm.page_id')
				.join('page_html_blobs as phb', 'phb.hash', 'phr.hash')
				.whereNotNull('pm.body_hash')
				.orderBy('pm.page_id')
				.select(
					'pm.body_hash as bodyHash',
					'phb.body as body',
					'phb.codec as codec',
				)) as {
				bodyHash: Uint8Array;
				body: Uint8Array;
				codec: string;
			}[];

			// The fixture holds exactly two crawled pages (`/` and `/about`).
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				const html = decodeStoredBlob(row.body, row.codec);
				expect(computeBodyHash(html).toString('hex')).toBe(
					Buffer.from(row.bodyHash).toString('hex'),
				);
			}
		} finally {
			await archive.close();
		}
	}, 60_000);
});
