const express = require("express");
const cors = require("cors");
const requireAuth = require("./middleware/requireAuth");
const requirePermission = require("./middleware/requirePermission");
const { getResponsibilities } = require("./auth/permissions");
const venueRoutes = require("./routes/venues.routes");
const equipmentRoutes = require("./routes/equipment.routes");
const errorHandler = require("./middleware/errorHandler");

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
  app.use("/api/venues", venueRoutes);
  app.use("/api", equipmentRoutes({ authenticate }));
  // Error-handling middleware must be registered last, after all routes.
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
