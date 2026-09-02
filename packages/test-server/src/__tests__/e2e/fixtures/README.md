# e2e fixtures

## `report-query-fixture.nitpicker`

A small, committed `.nitpicker` archive used by `report.e2e.ts` and
`query.e2e.ts`. Unlike every other e2e test in this suite, those two never
re-fetch anything from a live server — `report`/`query` only read a
completed archive — so a static fixture avoids paying for a live crawl on
every run and keeps the tested content independent of `basic.ts`'s routes
changing.

Produced by a real crawl of this package's own `basic.ts` routes (`/` and
`/about` — no external site, no client data), with the viewer read model
built in, then repacked with `tar`'s `portable: true` option to strip
OS-specific tar header metadata (owner/group name, `ctime`/`atime`) that the
production archive writer
(`packages/@nitpicker/crawler/src/archive/filesystem/tar.ts`) does not
strip by default.

Baked-in URLs (used verbatim by both e2e tests' `--urls` lists):

- `http://localhost:49375` — the root page (`status: 200`, title "Test Top").
- `http://localhost:49375/about` — the about page (`status: 200`, title "About").

### Regenerating

Only needed if the archive schema version changes (`ARCHIVE_SCHEMA_VERSION`)
or the fixture needs different content. From the repo root, with the
built CLI (`yarn build` first) and the test server running:

```sh
node --experimental-vm-modules -e "
import('node:child_process').then(async ({ execFileSync }) => {
  const cwd = '/tmp/nitpicker-fixture-gen';
  execFileSync('mkdir', ['-p', cwd]);
  execFileSync(process.execPath, ['packages/@nitpicker/cli/bin/nitpicker.js', 'crawl',
    'http://localhost:<TEST_SERVER_PORT>/', '--silent', '--no-image', '--no-fetch-external'], { cwd });
  // find the resulting *.nitpicker in cwd, then:
  execFileSync(process.execPath, ['packages/@nitpicker/cli/bin/nitpicker.js', 'viewer-build',
    '<path-to-that-file>', '--force'], { cwd });
});
"
```

Then repack it with `tar`'s Node API (`portable: true`) instead of copying
the crawl output directly — the raw output still carries this machine's OS
username in its tar header:

```js
import { create } from 'tar';
import path from 'node:path';

const dir = '<crawl output directory, e.g. cwd/localhost-.../>';
await create(
	{
		gzip: false,
		cwd: path.dirname(dir),
		file: '<output path>',
		preservePaths: false,
		portable: true,
	},
	[path.basename(dir)],
);
```

Verify the result contains no OS-specific strings before committing
(`grep -a <your-username> report-query-fixture.nitpicker` should find
nothing), and update the "Baked-in URLs" section above if the port or
content changed.
