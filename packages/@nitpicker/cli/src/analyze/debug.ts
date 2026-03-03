import debug from 'debug';

/**
 * Enables all `Nitpicker*` debug namespaces
 * so that analyze debug output is printed to stdout.
 */
export function verbosely() {
	if (!debug.enabled('Nitpicker')) {
		debug.enable('Nitpicker*');
	}
}
