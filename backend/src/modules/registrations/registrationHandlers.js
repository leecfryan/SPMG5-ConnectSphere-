const express = require("express");

module.exports = function registrationRoutes(dataClient) {
  const router = express.Router();

  // POST /api/registrations
  router.post("/", async (req, res) => {
    const { eventId, registrationData } = req.body ?? {};
    if (!eventId || typeof eventId !== "string") {
      return res.status(400).json({ message: "eventId is required." });
    }

    const { data: event, error: eventError } = await dataClient
      .from("events")
      .select("id, status")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      console.error("Event check error:", eventError.message);
      return res.status(500).json({ message: "Unable to submit your registration. Please try again." });
    }
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (event.status !== "APPROVED") {
      return res.status(409).json({ message: "Registration is not open for this event." });
    }

    const { data: existing } = await dataClient
      .from("registrations")
      .select("id")
      .eq("attendee_id", req.user.id)
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ message: "You are already registered for this event." });
    }

    const { data: registration, error } = await dataClient
      .from("registrations")
      .insert({
        event_id: eventId,
        attendee_id: req.user.id,
        status: "pending",
        registration_data: registrationData ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("Registration insert error:", error.message);
      return res.status(500).json({ message: "Unable to submit your registration. Please try again." });
    }

    res.status(201).json({ registration });
  });

  // GET /api/registrations/me
  router.get("/me", async (req, res) => {
    const { data: registrations, error } = await dataClient
      .from("registrations")
      .select("id, event_id, status, created_at, updated_at, registration_data, events(name, proposed_start)")
      .eq("attendee_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Registrations list error:", error.message);
      return res.status(500).json({ message: "Unable to load your registrations. Please try again." });
    }

    res.json({ registrations: registrations ?? [] });
  });

  // GET /api/registrations/me/:registrationId
  router.get("/me/:registrationId", async (req, res) => {
    const { data: registration, error } = await dataClient
      .from("registrations")
      .select("id, event_id, status, created_at, updated_at, registration_data")
      .eq("id", req.params.registrationId)
      .eq("attendee_id", req.user.id)
      .maybeSingle();

    if (error) {
      console.error("Registration fetch error:", error.message);
      return res.status(500).json({ message: "Unable to load your registration. Please try again." });
    }
    if (!registration) return res.status(404).json({ message: "Registration not found." });

    res.json({ registration });
  });

  // PATCH /api/registrations/:registrationId/withdraw
  router.patch("/:registrationId/withdraw", async (req, res) => {
    const { data: existing, error: fetchError } = await dataClient
      .from("registrations")
      .select("id, status")
      .eq("id", req.params.registrationId)
      .eq("attendee_id", req.user.id)
      .maybeSingle();

    if (fetchError) {
      console.error("Registration fetch error:", fetchError.message);
      return res.status(500).json({ message: "Unable to process your request. Please try again." });
    }
    if (!existing) return res.status(404).json({ message: "Registration not found." });
    if (existing.status === "withdrawn") {
      return res.status(409).json({ message: "This registration has already been withdrawn." });
    }

    const { data: registration, error } = await dataClient
      .from("registrations")
      .update({ status: "withdrawn" })
      .eq("id", req.params.registrationId)
      .eq("attendee_id", req.user.id)
      .select()
      .single();

    if (error) {
      console.error("Registration withdraw error:", error.message);
      return res.status(500).json({ message: "Unable to withdraw your registration. Please try again." });
    }

    res.json({ registration });
  });

  return router;
};
