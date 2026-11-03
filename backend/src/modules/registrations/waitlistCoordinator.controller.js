const { UUID_PATTERN } = require("../managedEvents/managedEvents.validation");

function handleFailure(error, res, next) {
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({
      error: error.code || "waitlist_request_failed",
      message: error.message,
    });
  }
  return next(error);
}

function createWaitlistCoordinatorController(service) {
  async function getCoordinatorWaitlist(req, res, next) {
    if (!UUID_PATTERN.test(req.params.eventId)) {
      return res.status(400).json({ message: "Invalid event id." });
    }
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
        !Number.isInteger(offset) || offset < 0) {
      return res.status(400).json({ message: "Use a limit from 1 to 50 and a non-negative offset." });
    }
    try {
      return res.json({
        waitlist: await service.getCoordinatorWaitlist(req.managedEvent, { limit, offset }),
      });
    } catch (error) {
      return handleFailure(error, res, next);
    }
  }

  async function getAutoOffers(req, res, next) {
    try {
      return res.json({ setting: await service.getAutoOffers(req.managedEvent) });
    } catch (error) {
      return handleFailure(error, res, next);
    }
  }

  async function setAutoOffers(req, res, next) {
    if (!req.body || typeof req.body.enabled !== "boolean") {
      return res.status(400).json({ message: "The enabled field must be a boolean." });
    }
    try {
      return res.json({
        setting: await service.setAutoOffers(req.managedEvent, req.body.enabled, req.user.id),
      });
    } catch (error) {
      return handleFailure(error, res, next);
    }
  }

  async function promoteEntry(req, res, next) {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
    const reason = body.reason === undefined ? null : body.reason;
    if (reason !== null && (typeof reason !== "string" || reason.length > 500)) {
      return res.status(400).json({ message: "The promotion reason must be a string of 500 characters or fewer." });
    }
    try {
      return res.json({
        result: await service.promoteEntry(
          req.managedEvent,
          req.params.entryId,
          req.user.id,
          reason,
        ),
      });
    } catch (error) {
      return handleFailure(error, res, next);
    }
  }

  return { getCoordinatorWaitlist, getAutoOffers, setAutoOffers, promoteEntry };
}

module.exports = createWaitlistCoordinatorController;
