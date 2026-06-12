/**
 * Sanitizes an error message by replacing absolute file paths with `<path>`.
 *
 * Mirrors the MCP server's sanitizer to avoid leaking internal directory
 * structures (e.g. the temporary extraction directory) in API error responses.
 * @param message - The raw error message.
 * @returns The sanitized message.
 */
export function sanitizeErrorMessage(message: string): string {
	return message.replaceAll(/(?:\/[^\s'",)]+){2,}/g, '<path>');
}
