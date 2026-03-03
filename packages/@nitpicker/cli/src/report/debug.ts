import debug from 'debug';

/**
 * Enables all `Nitpicker*` debug namespaces
 * so that report-google-sheets debug output is printed to stdout.
 */
export function verbosely() {
	if (!debug.enabled('Nitpicker')) {
		debug.enable('Nitpicker*');
	}
}
