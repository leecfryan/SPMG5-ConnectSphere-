const express = require("express");
const cors = require("cors");
const requireAuth = require("./middleware/requireAuth");

function createApp({ authClient, supabaseUrl, publishableKey, frontendOrigin = "http://localhost:5173" }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (req, res) => res.json({ message: "Server is healthy" }));
  // Only public browser configuration is exposed. Never include the admin client or secret key.
  app.get("/api/auth/config", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ supabaseUrl, publishableKey });
  });
  app.get("/api/auth/me", requireAuth(authClient), (req, res) => {
    res.json({ user: req.user });
  });
  return app;
}

module.exports = createApp;
