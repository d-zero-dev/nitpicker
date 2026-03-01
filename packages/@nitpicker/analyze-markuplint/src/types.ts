/**
 * Represents a slot element within a component's output structure.
 *
 * Mirrors markuplint's `Slot` type from `@markuplint/ml-config`.
 * Describes the wrapper element around a slot, along with optional
 * attributes and namespace information.
 *
 * @see {@link https://markuplint.dev/docs/guides/besides-html#pretenders}
 */
export interface SlotElement {
	/**
	 * The HTML element name that wraps the slot content.
	 *
	 * This is the element that directly contains the `<slot>` or `{children}` expression.
	 * For example, if the template is `<p><slot /></p>`, the element is `"p"`.
	 */
	readonly element: string;

	/**
	 * Namespace of the wrapper element.
	 *
	 * Only `"svg"` is supported. If omitted, the namespace is assumed to be HTML.
	 */
	readonly namespace?: 'svg';

	/**
	 * Additional attributes to apply to the wrapper element in the pretender model.
	 */
	readonly attrs?: readonly SlotElementAttr[];

	/**
	 * Whether the wrapper element should inherit attributes from the component element.
	 */
	readonly inheritAttrs?: boolean;
}

/**
 * Attribute definition for a slot wrapper element.
 */
export interface SlotElementAttr {
	/** Attribute name. */
	readonly name: string;

	/**
	 * Attribute value.
	 *
	 * - If omitted, the attribute is treated as a boolean attribute.
	 * - If a string, it is used as a literal value.
	 * - If an object with `fromAttr`, the value is copied from the
	 *   component element's attribute of that name.
	 */
	readonly value?: string | { readonly fromAttr: string };
}

/**
 * The result of slot detection in a component source file.
 *
 * Represents the `slots` field of markuplint's `OriginalNode` type:
 *
 * - `null` — The component does **not** accept children or slots
 *   (e.g. a self-closing root element like `<img />`).
 * - `true` — The component accepts children, and the outermost element
 *   is itself the children wrapper (e.g. `<button>{children}</button>`).
 * - `SlotElement[]` — The component has one or more specific slot locations,
 *   each described by the wrapper element that contains the slot.
 */
export type SlotsDetectionResult = null | true | readonly SlotElement[];
