const express = require("express");
const cors = require("cors");
const requireAuth = require("./middleware/requireAuth");
const requirePermission = require("./middleware/requirePermission");
const { getResponsibilities, getPermissions } = require("./auth/permissions");
const createVenuesRoutes = require("./routes/venues.routes");
const errorHandler = require("./middleware/errorHandler");
const registrationRoutes = require("./modules/registrations/registrationHandlers");
const registrationEventRoutes = require("./modules/registrations/eventHandlers");
const equipmentRoutes = require("./routes/equipment.routes");
const createEventsRoutes = require("./routes/events.routes");

function createApp({ authClient, dataClient, eventsRepository, venuesService, equipmentDependencies, supabaseUrl, publishableKey, frontendOrigin = "http://localhost:5173" }) {
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
    res.json({ user: req.user, permissions: getPermissions(req.user.roles) });
  });
  app.use("/api/events", createEventsRoutes(eventsRepository, authenticate));
  app.use("/api", equipmentRoutes({ authenticate, ...equipmentDependencies }));
  // These routes expose approved event information and each user's own registrations.
  app.use("/api/events", authenticate, registrationEventRoutes(dataClient));
  app.use("/api/registrations", authenticate, (req, res, next) => dataClient ? next() :
    res.status(503).json({ message: "This feature is not yet configured." }), registrationRoutes(dataClient));
  // All internal routes must be registered after this gate, with their own permission guard.
  app.use("/api/internal", authenticate, requirePermission("internal.access"));
  app.get("/api/internal/access", (req, res) => {
    res.json({ responsibilities: getResponsibilities(req.user.roles) });
  });
  app.use("/api/venues", authenticate, requirePermission("internal.access"), createVenuesRoutes(venuesService));
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
