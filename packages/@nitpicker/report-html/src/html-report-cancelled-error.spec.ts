import { describe, expect, it } from 'vitest';

import { HtmlReportCancelledError } from './html-report-cancelled-error.js';

describe('HtmlReportCancelledError', () => {
	it('identifies a cancelled directory prompt by name', () => {
		const error = new HtmlReportCancelledError();
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('HtmlReportCancelledError');
		expect(error.message).toBe('HTML report cancelled');
	});
});
