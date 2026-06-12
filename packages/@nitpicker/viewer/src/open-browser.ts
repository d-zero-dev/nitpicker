import { exec } from 'node:child_process';

/**
 * Opens the given URL in the OS default browser.
 *
 * Best-effort: failures are ignored (the server still runs and the URL is
 * printed to the console for manual access). Only ever called with a
 * local `http://host:port` URL produced by the viewer.
 * @param url - The URL to open.
 */
export function openBrowser(url: string): void {
	const command =
		process.platform === 'darwin'
			? 'open'
			: process.platform === 'win32'
				? 'start ""'
				: 'xdg-open';
	exec(`${command} "${url}"`);
}
