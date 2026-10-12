const express = require("express");

async function addAvailability(dataClient, events) {
  if (!events.length) return { events, error: null };

  const { data: availability, error } = await dataClient.rpc(
    "registration_availability_for_events",
    { p_event_ids: events.map((event) => event.id) },
  );
  if (error) return { events: null, error };

  if (!Array.isArray(availability)) {
    return { events: null, error: new Error("Availability RPC returned an invalid result.") };
  }
  const byEventId = new Map(availability.map((row) => [row.event_id, row]));
  if (events.some((event) => !byEventId.has(event.id))) {
    return { events: null, error: new Error("Availability RPC omitted an event.") };
  }
  return {
    events: events.map((event) => {
      const publicAvailability = Object.fromEntries(
        Object.entries(byEventId.get(event.id)).filter(([key]) => key !== "event_id"),
      );
      return { ...event, ...publicAvailability };
    }),
    error: null,
  };
}

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
    const result = await addAvailability(dataClient, events ?? []);
    if (result.error) {
      console.error("Event availability lookup error:", result.error.message);
      return res.status(500).json({ message: "Unable to load event availability. Please try again." });
    }
    res.json({ events: result.events });
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
    const result = await addAvailability(dataClient, [event]);
    if (result.error) {
      console.error("Event availability lookup error:", result.error.message);
      return res.status(500).json({ message: "Unable to load event availability. Please try again." });
    }
    res.json({ event: result.events[0] });
  });

  return router;
};
