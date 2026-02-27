import debug from 'debug';

/** Root debug logger for the Nitpicker application. Namespace: `Nitpicker`. */
export const globalLog = debug('Nitpicker');
/** Debug logger for the utils package. Namespace: `Nitpicker:Utils`. */
export const log = globalLog.extend('Utils');
