const express = require("express");
const cors = require("cors");
const requireAuth = require("./middleware/requireAuth");
const requirePermission = require("./middleware/requirePermission");
const { getResponsibilities } = require("./auth/permissions");
const registrationRoutes = require("./modules/registrations/registrationHandlers");

function createApp({ authClient, dataClient, supabaseUrl, publishableKey, frontendOrigin = "http://localhost:5173" }) {
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

  // Events routes — stub until the events module is built; queries public.events when the table exists.
  app.get("/api/events", authenticate, async (req, res) => {
    if (!dataClient) return res.status(503).json({ message: "This feature is not yet configured." });
    const { data: events, error } = await dataClient
      .from("events")
      .select("id, name, description, start_time, status")
      .eq("status", "APPROVED")
      .order("start_time", { ascending: true });
    if (error) {
      if (error.code === "42P01") return res.json({ events: [] });
      console.error("Events list error:", error.message);
      return res.status(500).json({ message: "Unable to load events. Please try again." });
    }
    res.json({ events: events ?? [] });
  });

  app.get("/api/events/:eventId", authenticate, async (req, res) => {
    if (!dataClient) return res.status(503).json({ message: "This feature is not yet configured." });
    const { data: event, error } = await dataClient
      .from("events")
      .select("id, name, purpose, description, start_time, end_time, expected_attendance, other_comments, status, registration_fields")
      .eq("id", req.params.eventId)
      .eq("status", "APPROVED")
      .maybeSingle();
    if (error) {
      if (error.code === "42P01") return res.status(404).json({ message: "Event not found." });
      console.error("Event fetch error:", error.message);
      return res.status(500).json({ message: "Unable to load event. Please try again." });
    }
    if (!event) return res.status(404).json({ message: "Event not found." });
    res.json({ event });
  });

  // Registration routes — ownership enforced inside handlers
  if (dataClient) {
    app.use("/api/registrations", authenticate, registrationRoutes(dataClient));
  } else {
    app.use("/api/registrations", (_req, res) => {
      res.status(503).json({ message: "This feature is not yet configured." });
    });
  }

  return app;
}

module.exports = createApp;
