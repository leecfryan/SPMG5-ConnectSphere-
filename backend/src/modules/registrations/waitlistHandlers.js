const express = require("express");
const createWaitlistService = require("./waitlistService");

function sendStorageError(res, message, error) {
  console.error(message, error?.message);
  return res.status(500).json({
    message: "Unable to process your waitlist request. Please try again.",
  });
}

module.exports = function createWaitlistRoutes(dataClient) {
  const router = express.Router();
  const service = dataClient ? createWaitlistService(dataClient) : null;

  router.post("/:eventId", async (req, res) => {
    const result = await service.join(req.params.eventId, req.user.id);
    if (!result.ok) {
      if (result.error?.code === "23505") {
        return res.status(409).json({ message: "You are already on this event's waitlist." });
      }
      if (result.reason === "storage_error") {
        return sendStorageError(res, "Waitlist join error:", result.error);
      }
      if (result.reason === "event_not_found") return res.status(404).json({ message: "Event not found." });
      if (result.reason === "already_waitlisted") {
        return res.status(409).json({ message: "You are already on this event's waitlist." });
      }
      if (result.reason === "already_registered") {
        return res.status(409).json({ message: "You are already registered for this event." });
      }
      if (result.reason === "event_not_full") {
        return res.status(409).json({ message: "This event is not full. Register for the event instead." });
      }
      if (result.reason === "event_not_open") {
        return res.status(409).json({ message: "Registration is not open for this event." });
      }
      if (result.reason === "registration_not_open") {
        return res.status(409).json({ message: "Registration has not opened yet." });
      }
      if (result.reason === "registration_closed") {
        return res.status(409).json({ message: "Registration has closed." });
      }
      return res.status(400).json({ message: "The waitlist request is invalid." });
    }
    return res.status(201).json({
      entry: result.entry,
      position: result.position,
    });
  });

  router.get("/:eventId", async (req, res) => {
    const result = await service.getPosition(req.params.eventId, req.user.id);
    if (!result.ok) {
      if (result.reason === "storage_error") {
        return sendStorageError(res, "Waitlist position lookup error:", result.error);
      }
      return res.status(404).json({ message: "You are not on this event's waitlist." });
    }
    return res.json({
      entry: result.entry,
      position: result.position,
    });
  });

  router.delete("/:eventId", async (req, res) => {
    const result = await service.withdraw(req.params.eventId, req.user.id);
    if (!result.ok) {
      if (result.reason === "storage_error") {
        return sendStorageError(res, "Waitlist withdrawal error:", result.error);
      }
      return res.status(404).json({ message: "You are not on this event's waitlist." });
    }
    return res.status(204).end();
  });

  return router;
};
