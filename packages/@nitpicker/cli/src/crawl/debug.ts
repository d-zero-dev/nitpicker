import debug from 'debug';

/** Debug logger for the Nitpicker CLI, scoped to the `Nitpicker:CLI` namespace. */
export const log = debug('Nitpicker').extend('CLI');

/**
 * Enables all `Nitpicker*` debug namespaces (excluding noisy Deal/DOM/Resource channels)
 * so that crawler debug output is printed to stdout.
 */
export function verbosely() {
	if (!debug.enabled('Nitpicker')) {
		debug.enable(
			'Nitpicker*,-Nitpicker:Crawler:Deal,-Nitpicker:Scraper:DOM:Details:*,-Nitpicker:Scraper:Resource:*',
		);
	}
}
