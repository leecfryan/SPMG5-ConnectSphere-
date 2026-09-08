const express = require("express");
const cors = require("cors");
const requireAuth = require("./middleware/requireAuth");
const requirePermission = require("./middleware/requirePermission");
const { getResponsibilities } = require("./auth/permissions");

function createApp({ authClient, supabaseUrl, publishableKey, frontendOrigin = "http://localhost:5173" }) {
  const app = express();
  const authenticate = requireAuth(authClient);
  app.disable("x-powered-by");
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (req, res) => res.json({ message: "Server is healthy" }));
  // Only public browser configuration is exposed. Never include the admin client or secret key.
  app.get("/api/auth/config", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ supabaseUrl, publishableKey });
  });
  app.get("/api/auth/me", authenticate, (req, res) => {
    res.json({ user: req.user });
  });
  // All internal routes must be registered after this gate, with their own permission guard.
  app.use("/api/internal", authenticate, requirePermission("internal.access"));
  app.get("/api/internal/access", (req, res) => {
    res.json({ responsibilities: getResponsibilities(req.user.roles) });
  });
  return app;
}

module.exports = createApp;
