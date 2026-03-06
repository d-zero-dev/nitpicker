import { parseCli } from '@d-zero/roar';

import { analyze, commandDef as analyzeDef } from './commands/analyze.js';
import { crawl, commandDef as crawlDef } from './commands/crawl.js';
import { pipeline, commandDef as pipelineDef } from './commands/pipeline.js';
import { report, commandDef as reportDef } from './commands/report.js';
import { ExitCode } from './exit-code.js';
import { formatCliError } from './format-cli-error.js';

process.title = 'Nitpicker CLI';

const cli = parseCli({
	name: 'nitpicker',
	commands: {
		crawl: crawlDef,
		analyze: analyzeDef,
		report: reportDef,
		pipeline: pipelineDef,
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
	}
} catch (error) {
	formatCliError(error, true);
	process.exit(ExitCode.Fatal);
}
