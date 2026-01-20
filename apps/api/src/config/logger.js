import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] | ${level} | ${message}`;
                })
            )
        }),
        new winston.transports.File({ filename: process.env.LOG_FILE || 'server.log' })
    ]
});

export default logger;
