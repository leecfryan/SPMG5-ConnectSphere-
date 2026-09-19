function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large" });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

module.exports = errorHandler;
