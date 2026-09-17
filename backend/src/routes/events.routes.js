const express = require("express");
const controller = require("../modules/events/events.controller");

const router = express.Router();

// POST /api/events - create and submit an event request (US-12 + US-14).
// Saved as SUBMITTED; drafts arrive with US-13.
// Unguarded for now; the requireAuth / requirePermission gates land with the
// `feature/SignIn` rebase, alongside the real organiser id.
router.post("/", controller.create);

module.exports = router;
