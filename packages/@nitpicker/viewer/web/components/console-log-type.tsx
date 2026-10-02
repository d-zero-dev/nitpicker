/** Props for {@link ConsoleLogType}. */
export interface ConsoleLogTypeProps {
	/** The console message type, or `'pageerror'` for an uncaught exception. */
	type: string;
}

/**
 * The console types the viewer tells apart by color. Anything else (a type a
 * future Puppeteer adds) renders in the neutral style under its own name.
 */
const KNOWN_TYPES = new Set(['pageerror', 'error', 'warn', 'info', 'log', 'debug']);

/**
 * A console message's type as a colored badge: `pageerror` (an uncaught
 * exception) is solid red, `error` red, `warn` amber, `info` blue, and `log`
 * / `debug` neutral. The type's name is always the badge's text, so the
 * distinction never rests on color alone.
 * @param props - The console type.
 * @returns The badge element.
 * @example
 * <ConsoleLogType type="error" />
 */
export function ConsoleLogType(props: ConsoleLogTypeProps) {
	const variant = KNOWN_TYPES.has(props.type) ? props.type : 'other';
	return <span className={`console-type console-type-${variant}`}>{props.type}</span>;
}
