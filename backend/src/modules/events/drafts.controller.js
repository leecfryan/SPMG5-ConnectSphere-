const service = require("./events.service");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SCRUM-147 AC4: a draft that belongs to someone else answers exactly like one
// that does not exist, so no account can learn another organiser's drafts.
const FAILURES = Object.freeze({
  invalid: [400, "Check the event details and try again."],
  not_found: [404, "Draft not found."],
  conflict: [409, "This draft has changed or was already submitted. Refresh and try again."],
});

const LOAD_FAILED = "Could not load your drafts. Please try again.";

function createDraftsController(repository) {
  // Identity comes from the verified token only, never from the body.
  function handle(action, run, { created = 200, failure = "Could not save the draft. Please try again." } = {}) {
    return async (req, res) => {
      if (!repository) {
        return res.status(503).json({ message: "Event drafts are not configured. Please try again later." });
      }
      if (req.params.id !== undefined && !UUID.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid draft id." });
      }
      try {
        const result = await run(req);
        if (result.ok) return res.status(created).json(result.body ?? { event: result.event });
        const [status, message] = FAILURES[result.reason];
        return res.status(status).json(result.errors ? { message, errors: result.errors } : { message });
      } catch (error) {
        // The repository puts the Supabase message in here; it is for the log,
        // not for the organiser's screen.
        console.error(`${action} failed:`, error.message);
        return res.status(500).json({ message: failure });
      }
    };
  }

  return {
    create: handle("POST /api/events/drafts",
      (req) => service.saveDraft(req.body, req.user.id, repository), { created: 201 }),
    list: handle("GET /api/events/drafts",
      async (req) => ({ ok: true, body: { drafts: await repository.findOwnDrafts(req.user.id) } }), { failure: LOAD_FAILED }),
    find: handle("GET /api/events/drafts/:id", async (req) => {
      const event = await repository.findOwnDraft(req.params.id, req.user.id);
      return event ? { ok: true, event } : { ok: false, reason: "not_found" };
    }, { failure: LOAD_FAILED }),
    update: handle("PATCH /api/events/drafts/:id",
      (req) => service.updateDraft(req.params.id, req.body, req.user.id, repository)),
    submit: handle("POST /api/events/drafts/:id/submit",
      (req) => service.submitDraft(req.params.id, req.body, req.user.id, repository)),
  };
}

module.exports = createDraftsController;
