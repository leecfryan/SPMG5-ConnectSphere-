const {
  validateCreateMessage,
  validateUpdateMessage,
} = require("./messages.validation");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Takes its data-access dependencies rather than importing them, so tests
// can inject fakes (see messages.functional.test.js) - same reasoning as
// equipment.controller.js. equipment.routes.js is the only place that wires
// this to the real services, the real events repository, and the real
// retention module.
function createMessagesController({
  messagesService,
  equipmentService,
  findEventById,
  retention,
}) {
  const { listByEquipmentRequestIds, findById, create, updateBody } = messagesService;
  const { listRequestsByEvent, findRequestById } = equipmentService;
  const { isMessageExpired } = retention;

  // AC4: Technical Support Staff can access any event's thread; an Event
  // Coordinator only the events they coordinate - the Event Organiser has
  // no access at all (there is no third branch for them). Enforced here,
  // not left to the UI to hide.
  function canAccessEvent(req, event) {
    if (req.user.roles.includes("technical_support_staff")) return true;
    return req.user.roles.includes("event_coordinator") && event.coordinator_id === req.user.id;
  }

  // Scrum-28-Scrum65 (AC3): one event's clarification thread, aggregated
  // across every equipment line under it (the real messages table links to
  // equipment_request_id, not event_id - see messages.service.js). Past
  // retention, this returns an empty thread regardless of what's still in
  // the table (see retention.js).
  async function getEventMessages(req, res, next) {
    try {
      const { eventId } = req.params;
      if (!UUID_PATTERN.test(eventId)) {
        return res.status(400).json({ error: "Invalid event id" });
      }

      const event = await findEventById(eventId);
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (!canAccessEvent(req, event)) {
        return res.status(403).json({ error: "You do not have permission to view this thread" });
      }

      if (isMessageExpired(event)) return res.status(200).json({ data: [] });

      const requests = await listRequestsByEvent(eventId);
      const messages = await listByEquipmentRequestIds(requests.map((r) => r.id));
      res.status(200).json({ data: messages });
    } catch (err) {
      next(err);
    }
  }

  // Scrum-28-Scrum65 (AC3): record a question, comment or clarification
  // need against the event, tied to a specific equipment line.
  async function postEventMessage(req, res, next) {
    try {
      const { eventId } = req.params;
      if (!UUID_PATTERN.test(eventId)) {
        return res.status(400).json({ error: "Invalid event id" });
      }

      const event = await findEventById(eventId);
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (!canAccessEvent(req, event)) {
        return res.status(403).json({ error: "You do not have permission to post to this thread" });
      }

      if (isMessageExpired(event)) return res.status(410).json({ error: "This clarification thread has expired" });

      const { ok, errors, value } = validateCreateMessage(req.body);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      // The equipment line must actually belong to this event - never trust
      // the client to have associated them correctly (same reasoning
      // equipment.controller.js documents for event_id vs the URL).
      const request = await findRequestById(value.equipment_request_id);
      if (!request || request.event_id !== eventId) {
        return res.status(404).json({ error: "Equipment request not found for this event" });
      }

      const message = await create(value, req.user.id, req.user.roles.includes("technical_support_staff") ? "tech_support" : "event_coordinator");
      res.status(201).json({ data: message });
    } catch (err) {
      next(err);
    }
  }

  // Scrum-28-Scrum65 (AC3): edit your own message - not stated in the ACs,
  // but implied by the real schema's updated_at column and trigger, and by
  // the original task's audit section naming "updates to clarification" as
  // an action to expect.
  async function patchMessage(req, res, next) {
    try {
      const { id } = req.params;
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ error: "Invalid message id" });
      }

      const existing = await findById(id);
      if (!existing) return res.status(404).json({ error: "Message not found" });

      const request = await findRequestById(existing.equipment_request_id);
      const event = request ? await findEventById(request.event_id) : null;
      if (!event || !canAccessEvent(req, event)) {
        return res.status(403).json({ error: "You do not have permission to edit this message" });
      }
      if (isMessageExpired(event)) return res.status(410).json({ error: "This clarification thread has expired" });
      if (existing.author_id !== req.user.id) {
        return res.status(403).json({ error: "You can only edit your own message" });
      }

      const { ok, errors, value } = validateUpdateMessage(req.body);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      const updated = await updateBody(id, value.body);
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  return { getEventMessages, postEventMessage, patchMessage };
}

module.exports = { createMessagesController };
