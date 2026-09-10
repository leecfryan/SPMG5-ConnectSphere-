const { listVenues, getVenueById, updateVenue } = require("./venues.service");
const { validateVenueUpdate } = require("./venues.validation");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getVenues(req, res, next) {
  try {
    const { city, minCapacity } = req.query;

    if (minCapacity !== undefined && Number.isNaN(Number(minCapacity))) {
      return res.status(400).json({ error: "minCapacity must be a number" });
    }

    const venues = await listVenues({
      city,
      minCapacity: minCapacity === undefined ? undefined : Number(minCapacity),
    });

    res.status(200).json({ data: venues });
  } catch (err) {
    next(err);
  }
}

async function getVenue(req, res, next) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid venue id" });
    }

    const venue = await getVenueById(id);
    if (!venue) return res.status(404).json({ error: "Venue not found" });

    res.status(200).json({ data: venue });
  } catch (err) {
    next(err);
  }
}

async function patchVenue(req, res, next) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid venue id" });
    }

    const { errors, value } = validateVenueUpdate(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const existing = await getVenueById(id);
    if (!existing) {
      return res.status(404).json({ error: "Venue not found" });
    }

    const venue = await updateVenue(id, value);
    res.status(200).json({ data: venue });
  } catch (err) {
    next(err);
  }
}

module.exports = { getVenues, getVenue, patchVenue };