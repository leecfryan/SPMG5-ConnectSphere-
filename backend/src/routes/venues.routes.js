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
  router.get("/booking-requests", requirePermission("bookings.read", bookingScope), available, controller.getBookingRequests);
  router.get("/booking-requests/:requestId", requirePermission("bookings.read", bookingScope), available, controller.getBookingRequest);
  router.get("/", requirePermission("venues.read"), available, controller.getVenues);
  router.get("/:id", requirePermission("venues.read"), available, controller.getVenue);
  router.get("/:id/availability", requirePermission("venues.read"), available, controller.getVenueAvailability);
  router.patch("/:id", requirePermission("venues.update"), available, controller.patchVenue);
  router.post("/:id/booking-requests", requirePermission("bookings.request"), available, controller.postBookingRequest);
  // SCRUM-22: Venue Staff decide a request. bookingScope is applied so the
  // response comes back through the same visibility rule as the review list.
  router.patch("/booking-requests/:requestId/decision", requirePermission("bookings.decide", bookingScope), available, controller.patchBookingRequestDecision);
  return router;
};
