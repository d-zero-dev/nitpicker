// Shim to fix CJS/ESM interop for await-event-emitter in Vite SSR.
// Vite unwraps CJS default exports, but the source code expects .default access.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const _AwaitEventEmitter = require('await-event-emitter');

const mod =
	typeof _AwaitEventEmitter === 'function'
		? { default: _AwaitEventEmitter }
		: _AwaitEventEmitter;

export default mod;
