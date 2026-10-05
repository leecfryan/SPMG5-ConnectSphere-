const express = require("express");
const {
  claimRegistrationSeat,
  releaseClaimedSeat,
  releaseRegistrationSeat,
} = require("./registrationSeats");

const FULL_MESSAGE =
  "This event has reached or exceeded capacity. Registration is unavailable; waiting-list redirection is pending implementation.";
const BUSY_MESSAGE =
  "Registration is busy right now. Please retry.";

function logSeatReleaseFailure(message, result) {
  if (result.error || result.exhausted || !result.released) {
    console.error(message, result.error?.message || "compare-and-set did not update a row");
  }
}

module.exports = function registrationRoutes(dataClient) {
  const router = express.Router();

  // POST /api/registrations
  router.post("/", async (req, res) => {
    const { eventId, registrationData } = req.body ?? {};
    if (!eventId || typeof eventId !== "string") {
      return res.status(400).json({ message: "eventId is required." });
    }

    if (registrationData != null && (typeof registrationData !== "object" || Array.isArray(registrationData) ||
      Object.values(registrationData).some((value) => value != null && typeof value !== "string"))) {
      return res.status(400).json({ message: "Registration details must contain text field values." });
    }

    const { data: event, error: eventError } = await dataClient
      .from("events")
      .select("id, status, registration_fields, enrolled_attendees, expected_attendance, registration_start, registration_end")
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

    const requiredFields = (event.registration_fields ?? []).filter((f) => f.required);
    for (const field of requiredFields) {
      const val = registrationData?.[field.id];
      if (!val || (typeof val === "string" && !val.trim())) {
        return res.status(400).json({ message: `${field.label} is required.` });
      }
    }

    const now = Date.now();
    if (event.registration_start && now < new Date(event.registration_start).getTime()) {
      return res.status(409).json({
        message: `Registration has not opened yet. It opens on ${new Date(event.registration_start).toISOString()}.`,
      });
    }
    if (event.registration_end && now > new Date(event.registration_end).getTime()) {
      return res.status(409).json({ message: "Registration has closed." });
    }

    const { data: existing, error: duplicateError } = await dataClient
      .from("registrations")
      .select("id")
      .eq("attendee_id", req.user.id)
      .eq("event_id", eventId)
      .maybeSingle();

    if (duplicateError) return res.status(500).json({ message: "Unable to submit your registration. Please try again." });
    if (existing) {
      return res.status(409).json({ message: "You are already registered for this event." });
    }

    const claim = await claimRegistrationSeat(dataClient, eventId, event);
    if (claim.status === "full") {
      return res.status(409).json({ message: FULL_MESSAGE });
    }
    if (claim.status === "busy") {
      return res.status(503).json({ message: BUSY_MESSAGE });
    }
    if (claim.status === "missing") {
      return res.status(404).json({ message: "Event not found." });
    }
    if (claim.status === "error") {
      console.error("Registration seat claim error:", claim.error?.message);
      return res.status(500).json({ message: "Unable to submit your registration. Please try again." });
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
      try {
        const release = await releaseClaimedSeat(dataClient, eventId, claim.enrolled);
        logSeatReleaseFailure("Registration seat release failed:", release);
      } catch (releaseError) {
        console.error(
          "Registration seat release failed:",
          releaseError instanceof Error ? releaseError.message : String(releaseError),
        );
      }
      if (error.code === "23505") return res.status(409).json({ message: "You are already registered for this event." });
      console.error("Registration insert error:", error.message);
      return res.status(500).json({ message: "Unable to submit your registration. Please try again." });
    }

    res.status(201).json({ registration });
  });

  // GET /api/registrations/me
  router.get("/me", async (req, res) => {
    const { data: registrations, error } = await dataClient
      .from("registrations")
      .select("id, event_id, status, created_at, updated_at, registration_data, events(name, start_time)")
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
      .select("id, event_id, status, created_at, updated_at, registration_data, events(start_time)")
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
      .select("id, event_id, status, events(start_time)")
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
    if (existing.status === "confirmed") {
      return res.status(403).json({ message: "Your registration has been confirmed and cannot be withdrawn. Contact the organiser." });
    }

    const eventStart = existing.events?.start_time ? new Date(existing.events.start_time) : null;
    const now = new Date();
    if (eventStart && now >= eventStart) {
      return res.status(409).json({ message: "This event has already started and your registration cannot be withdrawn." });
    }
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (eventStart && eventStart - now < TWENTY_FOUR_HOURS) {
      return res.status(409).json({ message: "Withdrawals are not permitted within 24 hours of the event." });
    }

    const { data: registration, error } = await dataClient
      .from("registrations")
      .update({ status: "withdrawn" })
      .eq("id", req.params.registrationId)
      .eq("attendee_id", req.user.id)
      .eq("status", existing.status)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(409).json({ message: "This registration has already changed." });
      }
      console.error("Registration withdraw error:", error.message);
      return res.status(500).json({ message: "Unable to withdraw your registration. Please try again." });
    }

    // New registrations begin as pending and hold a seat. Confirmed rows are
    // also counted, but this endpoint already prevents withdrawing them.
    if (existing.status === "pending") {
      try {
        const release = await releaseRegistrationSeat(dataClient, existing.event_id);
        logSeatReleaseFailure("Withdrawn registration seat release failed:", release);
      } catch (releaseError) {
        console.error(
          "Withdrawn registration seat release failed:",
          releaseError instanceof Error ? releaseError.message : String(releaseError),
        );
      }
    }

    res.json({ registration });
  });

  return router;
};
