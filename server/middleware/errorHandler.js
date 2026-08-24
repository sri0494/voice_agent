import { logger } from "../utils/logger.js";

export class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: "Route not found" });
}

// Express error handler — must have 4 args to be recognized as such.
export function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  logger.error("unhandled_error", {
    requestId: req.requestId,
    endpoint: req.originalUrl,
    message: err.message,
    statusCode,
  });
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "Something went wrong" : err.message,
  });
}
