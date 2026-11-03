const express = require("express");
const createWaitlistService = require("./waitlistService");

function sendStorageError(res, message, error) {
  console.error(message, error?.message);
  return res.status(500).json({
    message: "Unable to process your waitlist request. Please try again.",
  });
}

function sendWaitlistError(res, result) {
  if (result.reason === "storage_error") {
    return sendStorageError(res, "Waitlist request error:", result.error);
  }
  if (result.reason === "event_not_found") {
    return res.status(404).json({ code: result.reason, message: "Event not found." });
  }
  if (result.reason === "already_waitlisted") {
    return res.status(409).json({
      code: result.reason,
      message: "You are already on this event's waitlist.",
    });
  }
  if (result.reason === "already_registered") {
    return res.status(409).json({
      code: result.reason,
      message: "You are already registered for this event.",
    });
  }
  if (result.reason === "event_not_full") {
    return res.status(409).json({
      code: result.reason,
      message: "This event is not full. Register for the event instead.",
    });
  }
  if (result.reason === "invalid_registration_data") {
    return res.status(400).json({
      code: result.reason,
      message: "Registration details are invalid or incomplete.",
    });
  }
  if (result.reason === "event_not_open" || result.reason === "event_ineligible") {
    return res.status(409).json({
      code: result.reason,
      message: "This event is not accepting waitlist requests.",
    });
  }
  if (result.reason === "offer_not_found" || result.reason === "not_found") {
    return res.status(404).json({
      code: result.reason,
      message: "You do not have an active waitlist entry or offer for this event.",
    });
  }
  if (result.reason === "expired") {
    return res.status(409).json({
      code: result.reason,
      message: "This waitlist offer has expired.",
    });
  }
  if (result.reason === "details_required") {
    return res.status(409).json({
      code: result.reason,
      message: "Complete the required registration details before accepting this offer.",
    });
  }
  if (result.reason === "capacity_counter_overflow") {
    return res.status(409).json({
      code: result.reason,
      message: "This event cannot accept additional registrations.",
    });
  }
  if (result.reason === "capacity_unavailable") {
    return res.status(409).json({
      code: result.reason,
      message: "This event no longer has an available place for this offer.",
    });
  }
  return res.status(400).json({
    code: result.reason ?? "invalid_request",
    message: "The waitlist request is invalid.",
  });
}

module.exports = function createWaitlistRoutes(dataClient) {
  const router = express.Router();
  const service = dataClient ? createWaitlistService(dataClient) : null;

  async function sendPosition(req, res) {
    const result = await service.getPosition(req.params.eventId, req.user.id);
    if (!result.ok && result.reason === "not_found") {
      return res.json({
        entry: null,
        position: null,
        effective_deadline: null,
        server_time: null,
      });
    }
    if (!result.ok) return sendWaitlistError(res, result);
    return res.json({
      entry: result.entry,
      position: result.position,
      effective_deadline: result.effectiveDeadline,
      server_time: result.serverTime,
    });
  }

  router.post("/:eventId/offer/accept", async (req, res) => {
    const result = await service.acceptOffer(req.params.eventId, req.user.id);
    if (!result.ok) return sendWaitlistError(res, result);
    return res.status(200).json({
      registrationId: result.registration_id,
      serverTime: result.server_time,
    });
  });

  router.post("/:eventId/offer/decline", async (req, res) => {
    const result = await service.declineOffer(req.params.eventId, req.user.id);
    if (!result.ok) return sendWaitlistError(res, result);
    return res.status(204).end();
  });

  router.put("/:eventId/details", async (req, res) => {
    const result = await service.updateRegistrationData(
      req.params.eventId,
      req.user.id,
      req.body?.registrationData,
    );
    if (!result.ok) return sendWaitlistError(res, result);
    return res.status(200).json({
      entry: result.entry,
      effective_deadline: result.effectiveDeadline,
      server_time: result.serverTime,
    });
  });

  router.post("/:eventId", async (req, res) => {
    const result = await service.join(
      req.params.eventId,
      req.user.id,
      req.body?.registrationData,
    );
    if (!result.ok) return sendWaitlistError(res, result);
    return res.status(201).json({
      entry: result.entry,
      position: result.position,
      server_time: result.serverTime,
    });
  });

  router.get("/:eventId/state", sendPosition);

  router.get("/:eventId", sendPosition);

  router.delete("/:eventId", async (req, res) => {
    const result = await service.withdraw(req.params.eventId, req.user.id);
    if (!result.ok) return sendWaitlistError(res, result);
    return res.status(204).end();
  });

  return router;
};
