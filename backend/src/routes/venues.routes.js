const express = require("express");
const createVenuesController = require("../modules/venues/venues.controller");
const requirePermission = require("../middleware/requirePermission");

module.exports = function createVenuesRoutes(service) {
  const router = express.Router();
  // Role checks run before storage checks, including when storage is unavailable.
  const available = (req, res, next) => service ? next() : res.status(503).json({
    message: "Venue storage is not configured. Please try again later.",
  });
  const controller = createVenuesController(service || {});
  // Venue Staff review venue responsibilities across all locations. Coordinators
  // see only bookings attached to their assigned events. Queries apply this scope.
  const bookingScope = (req) => {
    req.bookingScope = req.user.roles.includes("venue_staff")
      ? { allVenues: true } : { coordinatorId: req.user.id };
    return true;
  };
  router.get("/booking-events", requirePermission("bookings.request"), available, controller.getBookableEvents);
  // SCRUM-162: events with assigned coordinators, for the hold placement form.
  // Must be before /:id to avoid "events" matching as a venue id.
  router.get("/events", requirePermission("venues.holds"), controller.getEventsForHolds);
  router.get("/booking-requests", requirePermission("bookings.read", bookingScope), available, controller.getBookingRequests);
  router.get("/booking-requests/:requestId", requirePermission("bookings.read", bookingScope), available, controller.getBookingRequest);
  router.get("/booking-requests/:requestId/replacement-search", requirePermission("bookings.request"), available, controller.getReplacementSearch);
  router.post("/booking-requests/:requestId/mark-affected", requirePermission("venues.update"), available, controller.postMarkBookingAffected);
  router.post("/booking-requests/:requestId/release", requirePermission("bookings.request"), available, controller.postReleaseAffectedBooking);
  // SCRUM-138: one event's bookings, each checked on its own.
  router.get("/events/:eventId/booking-checks", requirePermission("bookings.read", bookingScope), available, controller.getEventBookingChecks);
  router.get("/", requirePermission("venues.read"), available, controller.getVenues);
  router.get("/:id", requirePermission("venues.read"), available, controller.getVenue);
  router.get("/:id/availability", requirePermission("venues.read"), available, controller.getVenueAvailability);
  // SCRUM-19: assessing a venue is part of deciding whether to request it, so it
  // sits behind bookings.request like the rest of the coordinator's booking flow.
  router.get("/:id/suitability", requirePermission("bookings.request"), available, controller.getVenueSuitability);
  router.patch("/:id", requirePermission("venues.update"), available, controller.patchVenue);
  router.post("/:id/booking-requests", requirePermission("bookings.request"), available, controller.postBookingRequest);
  // SCRUM-22: Venue Staff decide a request. bookingScope is applied so the
  // response comes back through the same visibility rule as the review list.
  router.patch("/booking-requests/:requestId/decision", requirePermission("bookings.decide", bookingScope), available, controller.patchBookingRequestDecision);
  // SCRUM-135: Venue Staff view conflict flags raised after a setup/turnaround change.
  router.get("/:id/booking-conflicts", requirePermission("venues.conflicts"), available, controller.getConflictFlags);
  // SCRUM-154: a coordinator changes or cancels one of their own requests.
  // bookings.manage is coordinator-only, so bookingScope always resolves to
  // their own coordinatorId here - the same scope rule as bookings.read/decide.
  router.patch("/booking-requests/:requestId", requirePermission("bookings.manage", bookingScope), available, controller.patchBookingRequest);
  router.patch("/booking-requests/:requestId/cancel", requirePermission("bookings.manage", bookingScope), available, controller.patchBookingRequestCancel);
  // SCRUM-133: Venue Staff manage unavailability periods for a venue.
  router.get("/:id/unavailability", requirePermission("venues.unavailability"), available, controller.getUnavailabilityPeriods);
  router.post("/:id/unavailability", requirePermission("venues.unavailability"), available, controller.postUnavailabilityPeriod);
  router.get("/:id/unavailability/:periodId/affected", requirePermission("venues.unavailability"), available, controller.getUnavailabilityPeriodAffected);
  router.patch("/:id/unavailability/:periodId", requirePermission("venues.unavailability"), available, controller.patchUnavailabilityPeriod);
  router.delete("/:id/unavailability/:periodId", requirePermission("venues.unavailability"), available, controller.deleteUnavailabilityPeriod);
  // SCRUM-146: Venue Staff place and view tentative holds.
  router.post("/:id/holds", requirePermission("venues.holds"), available, controller.postHold);
  router.get("/:id/holds", requirePermission("venues.holds"), available, controller.getHolds);
  // SCRUM-162: coordinator sees their own holds eligible for conversion.
  router.get("/:id/holds/eligible", requirePermission("bookings.request"), available, controller.getEligibleHolds);
  return router;
};
