import net from 'node:net';

/**
 * Finds a free TCP port, preferring the given one.
 *
 * Attempts to bind the preferred port; if it is in use (or otherwise
 * unbindable), falls back to an OS-assigned ephemeral port.
 *
 * The probe binds the **same `host`** the server will ultimately listen on.
 * This matters because `localhost` resolves to `::1` (IPv6) while an
 * unspecified bind uses `0.0.0.0`/`::`: probing a different interface than the
 * server uses can report a port as free that is actually taken on the server's
 * interface, so the fallback never triggers and the server crashes with
 * `EADDRINUSE`. Passing `host` keeps the probe and the real bind in lockstep.
 * @param preferred - The port to try first.
 * @param host - The host the server will bind to (probed identically). When
 *   omitted, the probe binds all interfaces.
 * @returns A port number that was successfully bound and released.
 */
export function findFreePort(preferred: number, host?: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const tryListen = (port: number, allowFallback: boolean) => {
			const server = net.createServer();
			server.unref();
			server.once('error', (error: NodeJS.ErrnoException) => {
				if (allowFallback && error.code === 'EADDRINUSE') {
					tryListen(0, false);
					return;
				}
				reject(error);
			});
			const onListening = () => {
				const address = server.address();
				const resolvedPort = typeof address === 'object' && address ? address.port : port;
				server.close(() => {
					resolve(resolvedPort);
				});
			};
			if (host == null) {
				server.listen(port, onListening);
			} else {
				server.listen(port, host, onListening);
			}
		};
		tryListen(preferred, true);
	});
}
