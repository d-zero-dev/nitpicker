import { parseCli } from '@d-zero/roar';

import { analyze, commandDef as analyzeDef } from './commands/analyze.js';
import { crawl, commandDef as crawlDef } from './commands/crawl.js';
import { report, commandDef as reportDef } from './commands/report.js';

process.title = 'Nitpicker CLI';

const cli = parseCli({
	name: 'nitpicker',
	commands: {
		crawl: crawlDef,
		analyze: analyzeDef,
		report: reportDef,
	},
	onError: () => true,
});

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
}
