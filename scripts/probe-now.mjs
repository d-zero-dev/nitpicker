/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import knex from 'knex';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { listPages } from '../packages/@nitpicker/query/lib/list-pages.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const tmpDir = process.argv[2];
if (!tmpDir) {
	console.error('Usage: node scripts/probe-now.mjs <tmpDir>');
	process.exit(1);
}

const db = knex({
	client: LibsqlDialect,
	connection: { filename: `${tmpDir}/db.sqlite` },
	useNullAsDefault: true,
});

const idx = await db.raw(
	`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_pages_listfilter'`,
);

console.log('idx_pages_listfilter:', idx[0]?.sql?.replaceAll(/\s+/g, ' ') ?? 'MISSING');

console.log('\nEXPLAIN COUNT (isExternal=0):');
const cp = await db.raw(
	`EXPLAIN QUERY PLAN
	 SELECT count(id) as t FROM pages
	  WHERE scraped=1 AND redirectDestId IS NULL
	    AND (contentType IS NULL OR contentType='text/html')
	    AND isExternal=0`,
);
for (const r of cp) {
	console.log('  ' + r.detail);
}

const accessor = { getKnex: () => db };
const t1 = process.hrtime.bigint();
const r = await listPages(accessor, { limit: 200, offset: 0, isExternal: false });
const lpMs = Number(process.hrtime.bigint() - t1) / 1e6;

console.log(
	`\nlistPages({isExternal:false, limit:200}) cold: ${lpMs.toFixed(0)}ms (${r.items.length} items, total=${r.total})`,
);

const t2 = process.hrtime.bigint();
await listPages(accessor, { limit: 200, offset: 0, isExternal: false });
const lpWarm = Number(process.hrtime.bigint() - t2) / 1e6;

console.log(`listPages warm: ${lpWarm.toFixed(0)}ms`);

const app = createApp({
	context: { archiveId: 'probe', manager: { get: () => accessor } },
	publicDir: '/tmp/no-such-dir',
});
const t3 = process.hrtime.bigint();
const res = await app.request('/api/pages?isExternal=false&limit=200&offset=0');
await res.text();
const httpMs = Number(process.hrtime.bigint() - t3) / 1e6;

console.log(`HTTP /api/pages?isExternal=false&limit=200: ${httpMs.toFixed(0)}ms`);

await db.destroy();
