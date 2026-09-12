// HTTP in, HTTP out. No Supabase, no rules - those live in the service.

const service = require("./events.service");

// TODO(SignIn rebase): delete this and read req.user.id behind requireAuth.
// `feature/SignIn` owns the auth middleware and has not merged yet, but
// events.organiser_id is NOT NULL, so every insert needs an owner from
// somewhere. Deliberately not taken from the request body: the owner of a
// record is never the client's to choose, and a body field would have to be
// designed out again later.
const DEV_ORGANISER_ID = "00000000-0000-0000-0000-000000000001";

async function create(req, res) {
  try {
    const result = await service.createDraft(req.body, DEV_ORGANISER_ID);
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    return res.status(201).json({ event: result.event });
  } catch (error) {
    // The repository puts the Supabase message in here; it is for the log, not
    // for the organiser's screen.
    console.error("POST /api/events failed:", error.message);
    return res
      .status(500)
      .json({ error: "Could not save the event request. Please try again." });
  }
}

module.exports = { create, DEV_ORGANISER_ID };
