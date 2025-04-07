export interface Logger {
	error: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
}

export const GLOBAL_LOGGER: Logger = {
	error: (...args: unknown[]) => console.error(...args),
	warn: (...args: unknown[]) => console.warn(...args),
	info: (...args: unknown[]) => console.info(...args),
	debug: (...args: unknown[]) => console.debug(...args),
};

export const setLogger = (logger: Logger) => {
	GLOBAL_LOGGER.error = logger.error;
	GLOBAL_LOGGER.warn = logger.warn;
	GLOBAL_LOGGER.info = logger.info;
	GLOBAL_LOGGER.debug = logger.debug;
};
