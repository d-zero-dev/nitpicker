import { log as globalLog } from './utils/debug.js';

/** Debug logger for the core package. Namespace: `Nitpicker`. */
export const log = globalLog;
/** Debug logger for the crawler module. Namespace: `Nitpicker:Crawler`. */
export const crawlerLog = log.extend('Crawler');
/** Debug logger for the dealer integration. Namespace: `Nitpicker:Crawler:Deal`. */
export const dealLog = crawlerLog.extend('Deal');
/** Debug logger for crawler errors. Namespace: `Nitpicker:Crawler:Error`. */
export const crawlerErrorLog = crawlerLog.extend('Error');
