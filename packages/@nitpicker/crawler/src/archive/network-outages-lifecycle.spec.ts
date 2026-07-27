import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Database } from './database.js';
import { remove } from './filesystem/remove.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const dbPath = path.resolve(workingDir, 'network-outages-lifecycle.sqlite');

beforeEach(async () => {
	await fs.rm(dbPath, { force: true });
});

afterEach(async () => {
	await remove(dbPath);
});

/**
 *
 */
async function openDb(): Promise<Database> {
	return Database.connect({ filename: dbPath });
}

describe('network_outages lifecycle across writer sessions', () => {
	it('is empty on a brand-new archive — no behaviour change for the common case', async () => {
		const db = await openDb();
		expect(await db.listNetworkOutages()).toEqual([]);
		await db.destroy();
	});

	it('durably closes a row left open by a crashed session, on the very next writer open', async () => {
		// Session 1: an outage is detected and recorded, then the process is
		// killed before a recovery probe can close it (`destroy()` here
		// stands in for the OS tearing down the process — the already
		// committed row on disk is what matters, not a graceful shutdown).
		const session1 = await openDb();
		await session1.insertNetworkOutage({
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await session1.destroy();

		// Session 2: `Database.connect` runs `init()` → `initSchema` →
		// `closeStaleOpenNetworkOutages` before anything else can read the
		// table, so the row from session 1 must already be closed here.
		const session2 = await openDb();
		const windows = await session2.listNetworkOutages();
		expect(windows).toEqual([{ startedAt: 100, endedAt: 100 }]);
		await session2.destroy();
	});

	it('a normal insert → close (recovery) round-trip within one session is unaffected by the boot-time finalizer', async () => {
		const db = await openDb();
		const id = await db.insertNetworkOutage({
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		await db.closeNetworkOutage(id, 1500);
		expect(await db.listNetworkOutages()).toEqual([{ startedAt: 100, endedAt: 1500 }]);
		await db.destroy();
	});
});
