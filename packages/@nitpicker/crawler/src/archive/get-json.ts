import { dbLog } from './debug.js';

/**
 * Safely parses a JSON string, returning a fallback value if parsing fails or the input is not a string.
 * Logs a warning via {@link dbLog} when invalid JSON is detected, including a truncated preview
 * of the data and the parse error message.
 * @template T The expected type of the parsed JSON value and the fallback.
 * @param data - The data to parse. Only string values are parsed; other types return the fallback.
 * @param fallback - The value to return if parsing fails or the result is falsy.
 * @returns The parsed JSON value, or the fallback.
 */
export function getJSON<T>(data: unknown, fallback: T): T {
	try {
		if (typeof data === 'string') {
			const result = JSON.parse(data);
			if (result) {
				return result;
			}
			return fallback;
		}
	} catch (error) {
		dbLog(
			'Warning: Invalid JSON detected in database field. Using fallback value. Data: %s, Error: %s',
			String(data).slice(0, 200),
			error instanceof Error ? error.message : String(error),
		);
	}

	return fallback;
}
