import { parseCli } from '@d-zero/roar';

import pkg from '../package.json' with { type: 'json' };

import { analyze, commandDef as analyzeDef } from './commands/analyze.js';
import { cache, commandDef as cacheDef } from './commands/cache.js';
import { crawl, commandDef as crawlDef } from './commands/crawl.js';
import { pipeline, commandDef as pipelineDef } from './commands/pipeline.js';
import { query, commandDef as queryDef } from './commands/query.js';
import { report, commandDef as reportDef } from './commands/report.js';
import { viewerBuild, commandDef as viewerBuildDef } from './commands/viewer-build.js';
import { viewer, commandDef as viewerDef } from './commands/viewer.js';
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
	switch (cli.command) {
		case 'crawl': {
			await crawl(cli.args, cli.flags);
			break;
		}
		case 'analyze': {
			await analyze(cli.args, cli.flags);
			break;
		}
		case 'report': {
			await report(cli.args, cli.flags);
			break;
		}
		case 'pipeline': {
			await pipeline(cli.args, cli.flags);
			break;
		}
		case 'query': {
			await query(cli.args, cli.flags);
			break;
		}
		case 'viewer': {
			await viewer(cli.args, cli.flags);
			break;
		}
		case 'viewer-build': {
			await viewerBuild(cli.args, cli.flags);
			break;
		}
		case 'cache': {
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
