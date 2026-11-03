const express = require("express");
const createEventsController = require("../modules/events/events.controller");
const createDraftsController = require("../modules/events/drafts.controller");

const requirePermission = require("../middleware/requirePermission");

// Guard only submission, allowing independently guarded event subresources.
function createEventsRoutes(repository, authenticate) {
  const router = express.Router();
  const organiser = [authenticate, requirePermission("events.submit")];
  router.post("/", ...organiser, createEventsController(repository));

  // SCRUM-147: drafts are part of submitting a request, so they share its
  // permission. Each query is scoped to the caller's own drafts, which is the
  // record check. Registered here, ahead of the registration router's
  // GET /api/events/:eventId, so "drafts" is never read as an event id.
  const drafts = createDraftsController(repository);
  router.post("/drafts", ...organiser, drafts.create);
  router.get("/drafts", ...organiser, drafts.list);
  router.get("/drafts/:id", ...organiser, drafts.find);
  router.patch("/drafts/:id", ...organiser, drafts.update);
  router.post("/drafts/:id/submit", ...organiser, drafts.submit);
  return router;
}

module.exports = createEventsRoutes;
