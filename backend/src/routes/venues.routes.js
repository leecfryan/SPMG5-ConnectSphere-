const express = require("express");
const {
  getVenues,
  getVenue,
  patchVenue,
} = require("../modules/venues/venues.controller");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

// SCRUM-16: which role owns venue updates is unconfirmed.
// Sprint goal defines Organizer, Coordinator, Attendee. The story says
// "Venue Staff". Update this list once the team confirms.
const VENUE_EDITOR_ROLES = ["Organizer", "Coordinator"];

router.get("/", getVenues);
router.get("/:id", getVenue);
router.patch("/:id", requireRole(...VENUE_EDITOR_ROLES), patchVenue);

module.exports = router;