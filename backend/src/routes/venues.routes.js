const express = require("express");
const {
  getVenues,
  getVenue,
  patchVenue,
  getVenueAvailability,
  getBookableEvents,
  postBookingRequest,
  getBookingRequests,
  getBookingRequest,
} = require("../modules/venues/venues.controller");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

// SCRUM-16: which role owns venue updates is unconfirmed.
// Sprint goal defines Organizer, Coordinator, Attendee. The story says
// "Venue Staff". Update this list once the team confirms.
const VENUE_EDITOR_ROLES = ["Organizer", "Coordinator"];

// SCRUM-21: role names match the RBAC on the develop branch
// (backend/src/auth/permissions.js), so moving from the x-user-role placeholder
// to requirePermission is a swap of middleware, not a rename.
//   event_coordinator submits requests, same split as equipment requests
//   venue_staff reviews them, matching the "bookings.read" policy
const BOOKING_REQUESTERS = ["event_coordinator"];
const BOOKING_REVIEWERS = ["venue_staff", "event_coordinator"];

// Fixed paths first. Registered after "/:id", Express would treat
// "booking-requests" as a venue id and reject it as an invalid uuid.
router.get("/booking-events", requireRole(...BOOKING_REQUESTERS), getBookableEvents);
router.get("/booking-requests", requireRole(...BOOKING_REVIEWERS), getBookingRequests);
router.get(
  "/booking-requests/:requestId",
  requireRole(...BOOKING_REVIEWERS),
  getBookingRequest
);

router.get("/", getVenues);
router.get("/:id", getVenue);

// SCRUM-17: read only, anyone who can view a venue can view its calendar
router.get("/:id/availability", getVenueAvailability);
router.patch("/:id", requireRole(...VENUE_EDITOR_ROLES), patchVenue);

// SCRUM-21: submit a booking request for this venue
router.post(
  "/:id/booking-requests",
  requireRole(...BOOKING_REQUESTERS),
  postBookingRequest
);

module.exports = router;
