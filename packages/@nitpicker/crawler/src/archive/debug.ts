import { log as globalLog } from '../utils/debug.js';

/** Debug logger for the archive package. Namespace: `Nitpicker:Utils:Archive`. */
export const log = globalLog.extend('Archive');
/** Debug logger for archive save operations. Namespace: `Nitpicker:Utils:Archive:Save`. */
export const saveLog = log.extend('Save');
/** Debug logger for database operations. Namespace: `Nitpicker:Utils:Archive:DB`. */
export const dbLog = log.extend('DB');
/** Debug logger for archive errors. Namespace: `Nitpicker:Utils:Archive:Error`. */
export const errorLog = log.extend('Error');
