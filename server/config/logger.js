'use strict';
// ============================================================
// config/logger.js — Winston structured logger
// ============================================================

require('dotenv').config();
const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs   = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    // ── Console (coloured, human-readable for dev) ─────────
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? '\n  ' + JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')
            : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      )
    }),
    // ── File: all logs ─────────────────────────────────────
    new transports.File({
      filename: path.join(logsDir, 'app.log'),
      maxsize:  10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    // ── File: errors only ──────────────────────────────────
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level:    'error',
      maxsize:  10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
