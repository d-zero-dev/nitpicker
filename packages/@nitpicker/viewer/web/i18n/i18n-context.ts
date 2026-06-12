import type { I18nValue } from '../types.js';

import { createContext } from 'react';

/** React context carrying the active locale and translate function. */
export const I18nContext = createContext<I18nValue | null>(null);
