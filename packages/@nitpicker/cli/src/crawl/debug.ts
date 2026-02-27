import debug from 'debug';

export const log = debug('Nitpicker').extend('CLI');

/**
 *
 */
export function verbosely() {
	if (!debug.enabled('Nitpicker')) {
		debug.enable(
			'Nitpicker*,-Nitpicker:Crawler:Deal,-Nitpicker:Scraper:DOM:Details:*,-Nitpicker:Scraper:Resource:*',
		);
	}
}
