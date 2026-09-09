const express = require("express");
const { getVenues, getVenue } = require("../modules/venues/venues.controller");

const router = express.Router();

router.get("/", getVenues);
router.get("/:id", getVenue);

module.exports = router;