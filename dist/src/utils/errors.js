/** Operational error carrying an HTTP status and a stable machine-readable code. */
class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

module.exports = { AppError };
