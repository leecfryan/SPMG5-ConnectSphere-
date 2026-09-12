const express = require("express");
const controller = require("../modules/events/events.controller");

const router = express.Router();

// POST /api/events - create a DRAFT event request (US-12).
// Unguarded for now; the requireAuth / requirePermission gates land with the
// `feature/SignIn` rebase, alongside the real organiser id.
router.post("/", controller.create);

module.exports = router;
