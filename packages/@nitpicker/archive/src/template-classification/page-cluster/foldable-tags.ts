/**
 * The "generic wrapper" tags: the native Stage A writes them as `.class`
 * (without the tag name) and folds them out of the path when they wrap a
 * single element (`segment.rs` in `nitpicker_template_cluster`); Stage B
 * reads a bare one as an anonymous wrapper. The two lists must agree, since
 * Stage B recognises what Stage A wrote.
 */
export const FOLDABLE_TAGS = new Set(['div', 'span']);
