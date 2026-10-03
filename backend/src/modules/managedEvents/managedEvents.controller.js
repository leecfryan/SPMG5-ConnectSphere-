const { UUID_PATTERN } = require("./managedEvents.validation");

function createManagedEventsController(service) {
  async function listManagedEvents(req, res, next) {
    try {
      res.json({ events: await service.listManagedEvents(req.user.id) });
    } catch (error) {
      next(error);
    }
  }

  async function getRegistrationSummary(req, res, next) {
    const { eventId } = req.params;
    if (!UUID_PATTERN.test(eventId)) {
      return res.status(400).json({ error: "Invalid event id" });
    }
    // The resolver put the event here after proving the user owns or manages
    // it. Reaching the controller without one would mean the guard was
    // bypassed, so this answers rather than fetching a second time.
    const event = req.managedEvent;
    if (!event) {
      return res.status(403).json({
        message: "You do not have permission to access this information.",
      });
    }
    try {
      res.json({
        summary: await service.getRegistrationSummary(event),
        server_time: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async function updateRegistrationWindow(req, res, next) {
    const event = req.managedEvent;
    if (!event) {
      return res.status(403).json({
        message: "You do not have permission to access this information.",
      });
    }

    try {
      const result = await service.updateRegistrationWindow(event, req.user.id, req.body);
      if (!result.ok) {
        return res.status(400).json({
          message: "Please correct the registration window.",
          details: result.errors,
        });
      }
      if (!result.event) {
        return res.status(403).json({
          message: "You do not have permission to access this information.",
        });
      }
      return res.json({
        event: result.event,
        server_time: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async function getRegistrationWindow(req, res, next) {
    const event = req.managedEvent;
    if (!event) {
      return res.status(403).json({
        message: "You do not have permission to access this information.",
      });
    }
    try {
      const window = await service.getRegistrationWindow(event.id, req.user.id);
      if (!window) {
        return res.status(403).json({
          message: "You do not have permission to access this information.",
        });
      }
      return res.json({ window, server_time: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  }

  return { listManagedEvents, getRegistrationSummary, getRegistrationWindow, updateRegistrationWindow };
}

module.exports = createManagedEventsController;
