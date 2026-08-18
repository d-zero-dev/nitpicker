import { parseCli } from '@d-zero/roar';

import pkg from '../package.json' with { type: 'json' };

import { commandDef as analyzeDef } from './commands/analyze-def.js';
import { commandDef as cacheDef } from './commands/cache-def.js';
import { commandDef as crawlDef } from './commands/crawl-def.js';
import { commandDef as pipelineDef } from './commands/pipeline-def.js';
import { commandDef as queryDef } from './commands/query-def.js';
import { commandDef as reportDef } from './commands/report-def.js';
import { commandDef as viewerBuildDef } from './commands/viewer-build-def.js';
import { commandDef as viewerDef } from './commands/viewer-def.js';
import { ExitCode } from './exit-code.js';
import { formatCliError } from './format-cli-error.js';

process.title = 'Nitpicker CLI';

const cli = parseCli({
	// WHY not the bare binary name: the CLI is published as a scoped package
	// with no global install story, so help/usage must show the invocation
	// that actually works in a terminal.
	name: 'npx @nitpicker/cli',
	version: pkg.version,
	commands: {
		crawl: crawlDef,
		analyze: analyzeDef,
		report: reportDef,
		pipeline: pipelineDef,
		query: queryDef,
		viewer: viewerDef,
		'viewer-build': viewerBuildDef,
		cache: cacheDef,
	},
	onError: () => true,
});

try {
	// Each branch dynamically imports only the implementation module for the
	// command actually invoked (issue #294) — `commandDef`s above are
	// imported eagerly (lightweight flag/usage metadata, needed for every
	// command's `--help`), but the implementations pull in the bulk of this
	// CLI's dependency tree (puppeteer, every `@nitpicker/analyze-*` plugin,
	// the Google Sheets auth stack, the React/jsdom-backed viewer server) —
	// loading all eight unconditionally on every invocation added several
	// seconds before the first byte of output, regardless of which single
	// command was actually run.
	switch (cli.command) {
		case 'crawl': {
			const { crawl } = await import('./commands/crawl.js');
			await crawl(cli.args, cli.flags);
			break;
		}
		case 'analyze': {
			const { analyze } = await import('./commands/analyze.js');
			await analyze(cli.args, cli.flags);
			break;
		}
		case 'report': {
			const { report } = await import('./commands/report.js');
			await report(cli.args, cli.flags);
			break;
		}
		case 'pipeline': {
			const { pipeline } = await import('./commands/pipeline.js');
			await pipeline(cli.args, cli.flags);
			break;
		}
		case 'query': {
			const { query } = await import('./commands/query.js');
			await query(cli.args, cli.flags);
			break;
		}
		case 'viewer': {
			const { viewer } = await import('./commands/viewer.js');
			await viewer(cli.args, cli.flags);
			break;
		}
		case 'viewer-build': {
			const { viewerBuild } = await import('./commands/viewer-build.js');
			await viewerBuild(cli.args, cli.flags);
			break;
		}
		case 'cache': {
			const { cache } = await import('./commands/cache.js');
			await cache(cli.args, cli.flags);
			break;
		}
	}
} catch (error) {
	formatCliError(error, true);
	process.exit(ExitCode.Fatal);
}

// Defensive: force exit after work completes. External dependencies (notably
// `@d-zero/beholder`'s DOM evaluation timeouts) leak unref'd-but-still-active
// timers via `Promise.race(..., setTimeout(..., 10_000))`, which can keep the
// event loop alive for up to 10 seconds after the CLI's work is done.
process.exit(process.exitCode ?? ExitCode.Success);
