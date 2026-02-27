/**
 * Makes the specified properties of `T` required while keeping
 * the rest unchanged. Used by `hasPropFilter` to narrow types
 * where an optional callback property is known to be defined.
 * @example
 * ```ts
 * type WithEachPage = RequiredProp<CreateSheetSetting, 'eachPage'>;
 * // eachPage is now non-optional
 * ```
 */
export type RequiredProp<T, P extends keyof T> = T & Required<Pick<T, P>>;
