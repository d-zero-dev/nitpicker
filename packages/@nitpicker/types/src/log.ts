/**
 * Callback for receiving log messages during plugin execution.
 * Passed to analyze plugins so they can report progress
 * without directly writing to stdout (which would interfere
 * with the deal() progress display).
 * @param log - The log message string
 */
export type ProcessLogger = (log: string) => void;
