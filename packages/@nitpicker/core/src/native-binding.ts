import type { NativeBinding } from './types.js';

import { loadNativeBinding } from './load-native-binding.js';

/**
 * The native addon, loaded once when this module is first imported.
 *
 * Loaded eagerly rather than on first call so an unsupported platform fails
 * at CLI startup with the supported-platform list, not halfway through a
 * crawl when the first page is hashed.
 */
export const nativeBinding: NativeBinding = loadNativeBinding();
