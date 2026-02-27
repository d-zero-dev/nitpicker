import type { PluginFactory } from '../types.js';

/**
 * Identity function that provides full type inference for analyze plugin definitions.
 *
 * This function does **nothing at runtime** - it returns its argument unchanged.
 * Its sole purpose is to give TypeScript enough context to infer the generic
 * parameters `O` (options type) and `T` (column key union) from the plugin
 * implementation, without requiring explicit type annotations at the call site.
 *
 * ## Why an identity function?
 *
 * Without this wrapper, plugin authors would need to manually annotate the
 * `PluginFactory` type with both generic parameters:
 *
 * ```ts
 * // Without definePlugin - verbose and error-prone
 * const factory: PluginFactory<{ lang: string }, 'score' | 'details'> = (options) => { ... };
 * export default factory;
 * ```
 *
 * With `definePlugin`, TypeScript infers everything from the function body:
 *
 * ```ts
 * // With definePlugin - concise and type-safe
 * export default definePlugin(async (options: { lang: string }) => {
 *   return {
 *     label: 'Custom Analysis',
 *     headers: { score: 'Score', details: 'Details' },
 *     async eachPage({ window }) {
 *       return { page: { score: { value: 100 }, details: { value: 'OK' } } };
 *     },
 *   };
 * });
 * ```
 *
 * This pattern is sometimes called a "satisfies helper" or "builder pattern"
 * and is common in TypeScript libraries that need generic inference from
 * function arguments (cf. Zod's `z.object()`, tRPC's `router()`).
 * @template O - Shape of the plugin's settings/options from the config file.
 * @template T - String literal union of column keys contributed by this plugin.
 * @param factory - The plugin factory function to pass through.
 * @returns The same function, unchanged.
 * @example
 * ```ts
 * import { definePlugin } from '@nitpicker/core';
 *
 * type Options = { keywords: string[] };
 *
 * export default definePlugin(async (options: Options) => {
 *   return {
 *     label: 'キーワード検索',
 *     headers: { found: 'Keywords Found', count: 'Match Count' },
 *     async eachPage({ html }) {
 *       const matches = options.keywords.filter(k => html.includes(k));
 *       return {
 *         page: {
 *           found: { value: matches.join(', ') },
 *           count: { value: matches.length },
 *         },
 *       };
 *     },
 *   };
 * });
 * ```
 * @see {@link ../types.ts!PluginFactory} for the function signature being wrapped
 * @see {@link ../types.ts!AnalyzePlugin} for the returned plugin interface
 */
export function definePlugin<O, T extends string = string>(
	factory: PluginFactory<O, T>,
): PluginFactory<O, T> {
	return factory;
}
