const { ACTIVE_STATUSES } = require("./lifecycle");
const { WRITABLE_COLS } = require("./events.repository");
const { normalise } = require("./events.service");
const { validateUpdate } = require("./events.validation");

const FIELDS = [
  "id", "name", "purpose", "description", "start_time", "end_time",
  "expected_attendance", "venue_requirements", "accessibility_needs",
  "equipment_needs", "other_comments", "status", "organiser_id",
  "coordinator_id", "submitted_at",
].join(",");

function isCoordinator(user) {
  return Boolean(user && !user.deleted_at && user.email_confirmed_at &&
    !(new Date(user.banned_until).getTime() > Date.now()) &&
    Array.isArray(user.app_metadata?.roles) && user.app_metadata.roles.includes("event_coordinator"));
}

function createEventWorkspaceService(client) {
  async function unwrap(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  // SCRUM-100: organisation membership comes only from admin-controlled Auth metadata.
  async function organiserIdsFor(userId) {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error) throw error;
    const organisationId = data?.user?.app_metadata?.organisation_id;
    if (typeof organisationId !== "string" || !organisationId.trim()) return [userId];
    const ids = new Set([userId]);
    for (let page = 1; ; page += 1) {
      const { data: directory, error: directoryError } = await client.auth.admin.listUsers({ page, perPage: 100 });
      if (directoryError) throw directoryError;
      for (const user of directory.users) {
        if (user.app_metadata?.organisation_id === organisationId) ids.add(user.id);
      }
      if (directory.users.length < 100) break;
    }
    return [...ids];
  }
  function scopedQuery(scope, userId, organiserIds) {
    let query = client.from("events").select(FIELDS);
    if (scope === "organiser") query = query.in("organiser_id", organiserIds);
    else if (scope === "coordinator") query = query.eq("coordinator_id", userId).in("status", ACTIVE_STATUSES);
    else if (scope === "manager") query = query.in("status", [...ACTIVE_STATUSES, "REJECTED"]);
    else throw new Error("Unknown event scope");
    return query;
  }
  async function read(scope, userId, id) {
    const organiserIds = scope === "organiser" ? await organiserIdsFor(userId) : undefined;
    const query = scopedQuery(scope, userId, organiserIds);
    return unwrap(id ? query.eq("id", id).maybeSingle() : query.order("submitted_at", { ascending: false }));
  }
  return {
    list: (scope, userId) => read(scope, userId),
    find: (scope, userId, id) => read(scope, userId, id),
    async updateOrganiserEvent(userId, id, input) {
      const current = await read("organiser", userId, id);
      if (!current) return { ok: false, reason: "not_found" };
      if (current.organiser_id !== userId) return { ok: false, reason: "forbidden" };
      if (!input || Array.isArray(input) || typeof input !== "object" ||
        Object.keys(input).length === 0 || Object.keys(input).some(field => !WRITABLE_COLS.includes(field))) {
        return { ok: false, reason: "invalid", errors: [{ field: "event", message: "Provide only editable event details." }] };
      }
      const { fields, errors } = normalise(input);
      const unreadable = new Set(errors.map(problem => problem.field));
      const problems = [...errors, ...validateUpdate(fields, current).errors.filter(problem => !unreadable.has(problem.field))];
      if (problems.length) return { ok: false, reason: "invalid", errors: problems };
      // SCRUM-100: recheck responsibility in the write itself, after the read check.
      const event = await unwrap(client.from("events").update(fields)
        .eq("id", id).eq("organiser_id", userId).select(FIELDS).maybeSingle());
      return event ? { ok: true, event } : { ok: false, reason: "conflict" };
    },
    async coordinators() {
      const choices = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        for (const user of data.users) if (isCoordinator(user)) {
          const name = user.user_metadata?.full_name;
          choices.push({ id: user.id, name: typeof name === "string" && name.trim() ? name.trim() : user.email || user.id, email: user.email });
        }
        if (data.users.length < 100) break;
      }
      return choices.sort((a, b) => a.name.localeCompare(b.name));
    },
    async isCoordinator(id) {
      const { data, error } = await client.auth.admin.getUserById(id);
      if (error?.status === 404) return false;
      if (error) throw error;
      return isCoordinator(data?.user);
    },
    assign(id, coordinatorId, expectedCoordinatorId) {
      let query = client.from("events").update({ coordinator_id: coordinatorId })
        .eq("id", id).in("status", ACTIVE_STATUSES);
      query = expectedCoordinatorId === null ? query.is("coordinator_id", null) : query.eq("coordinator_id", expectedCoordinatorId);
      return unwrap(query.select(FIELDS).maybeSingle());
    },
  };
}

module.exports = { createEventWorkspaceService };
