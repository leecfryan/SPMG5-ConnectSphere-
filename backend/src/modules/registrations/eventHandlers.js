const express = require("express");

module.exports = function registrationEventRoutes(dataClient) {
  const router = express.Router();
  router.get("/registration-windows", async (req, res) => {
    if (!dataClient) return res.status(503).json({ message: "This feature is not yet configured." });
    const { data: windows, error } = await dataClient
      .from("events")
      .select("id, registration_start, registration_end")
      .eq("status", "APPROVED");
    if (error) {
      console.error("Registration windows list error:", error.message);
      return res.status(500).json({ message: "Unable to load registration windows. Please try again." });
    }
    res.json({ windows: windows ?? [], server_time: new Date().toISOString() });
  });

  router.get("/registration-windows/:eventId", async (req, res) => {
    if (!dataClient) return res.status(503).json({ message: "This feature is not yet configured." });
    const { data: window, error } = await dataClient
      .from("events")
      .select("registration_start, registration_end")
      .eq("id", req.params.eventId)
      .eq("status", "APPROVED")
      .maybeSingle();
    if (error) {
      if (error.code === "42P01") return res.status(404).json({ message: "Event not found." });
      console.error("Registration window fetch error:", error.message);
      return res.status(500).json({ message: "Unable to load registration window. Please try again." });
    }
    if (!window) return res.status(404).json({ message: "Event not found." });
    res.json({ window, server_time: new Date().toISOString() });
  });

  router.get("/", async (req, res) => {
    if (!dataClient) return res.status(503).json({ message: "This feature is not yet configured." });
    const { data: events, error } = await dataClient
      .from("events")
      .select("id, name, description, start_time, status, enrolled_attendees, expected_attendance")
      .eq("status", "APPROVED")
      .order("start_time", { ascending: true });
    if (error) {
      if (error.code === "42P01") return res.json({ events: [] });
      console.error("Events list error:", error.message);
      return res.status(500).json({ message: "Unable to load events. Please try again." });
    }
    res.json({ events: events ?? [] });
  });

  router.get("/:eventId", async (req, res) => {
    if (!dataClient) return res.status(503).json({ message: "This feature is not yet configured." });
    const { data: event, error } = await dataClient
      .from("events")
      .select("id, name, purpose, description, start_time, end_time, enrolled_attendees, expected_attendance, status, registration_fields")
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

  return router;
};
