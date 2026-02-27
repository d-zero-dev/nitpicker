import debug from 'debug';

export const log = debug('Nitpicker').extend('GoogleSpreadsheet');
export const sheetLog = log.extend('Sheet');
export const archiveLog = log.extend('Archive');
export const reportLog = log.extend('Report');
export const pLog = log.extend('Plugin');
