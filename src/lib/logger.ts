// Browser-compatible logger that works in both client and server environments
interface LogData {
  error?: any;
  message?: string;
  [key: string]: any;
}

interface Logger {
  debug: (data: LogData | string) => void;
  info: (data: LogData | string) => void;
  warn: (data: LogData | string) => void;
  error: (data: LogData | string) => void;
}

const createLogger = (): Logger => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isBrowser = typeof window !== 'undefined';

  const formatMessage = (level: string, data: LogData | string): string => {
    const timestamp = new Date().toISOString();
    
    if (typeof data === 'string') {
      return `[${timestamp}] ${level.toUpperCase()}: ${data}`;
    }

    const { message, error, ...rest } = data;
    let logMessage = `[${timestamp}] ${level.toUpperCase()}:`;
    
    if (message) {
      logMessage += ` ${message}`;
    }
    
    if (error) {
      logMessage += ` | Error: ${error.message || error}`;
      if (error.stack && !isProduction) {
        logMessage += `\nStack: ${error.stack}`;
      }
    }
    
    if (Object.keys(rest).length > 0) {
      logMessage += ` | Data: ${JSON.stringify(rest)}`;
    }
    
    return logMessage;
  };

  const log = (level: 'debug' | 'info' | 'warn' | 'error', data: LogData | string) => {
    // Skip debug logs in production
    if (level === 'debug' && isProduction) return;

    const message = formatMessage(level, data);

    if (isBrowser) {
      // Browser environment - use console with appropriate styling
      switch (level) {
        case 'debug':
          console.debug('%c[DEBUG]', 'color: #6b7280', message);
          break;
        case 'info':
          console.info('%c[INFO]', 'color: #3b82f6', message);
          break;
        case 'warn':
          console.warn('%c[WARN]', 'color: #f59e0b', message);
          break;
        case 'error':
          console.error('%c[ERROR]', 'color: #ef4444', message);
          if (typeof data === 'object' && data.error) {
            console.error('Error details:', data.error);
          }
          break;
      }
    } else {
      // Server environment - use plain console
      console[level](message);
    }

  };

  return {
    debug: (data: LogData | string) => log('debug', data),
    info: (data: LogData | string) => log('info', data),
    warn: (data: LogData | string) => log('warn', data),
    error: (data: LogData | string) => log('error', data),
  };
};

const logger = createLogger();

export default logger;
