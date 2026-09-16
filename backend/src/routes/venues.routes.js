const express = require("express");
const {
  getVenues,
  getVenue,
  patchVenue,
  getVenueAvailability,
} = require("../modules/venues/venues.controller");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

// SCRUM-16: which role owns venue updates is unconfirmed.
// Sprint goal defines Organizer, Coordinator, Attendee. The story says
// "Venue Staff". Update this list once the team confirms.
const VENUE_EDITOR_ROLES = ["Organizer", "Coordinator"];

router.get("/", getVenues);
router.get("/:id", getVenue);

// SCRUM-17: read only, anyone who can view a venue can view its calendar
router.get("/:id/availability", getVenueAvailability);
router.patch("/:id", requireRole(...VENUE_EDITOR_ROLES), patchVenue);

module.exports = router;