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
  function scopedQuery(scope, userId) {
    let query = client.from("events").select(FIELDS);
    if (scope === "organiser") query = query.eq("organiser_id", userId);
    else if (scope === "coordinator") query = query.eq("coordinator_id", userId).in("status", ["ACCEPTED", "APPROVED"]);
    else if (scope === "manager") query = query.in("status", ["SUBMITTED", "ACCEPTED", "APPROVED", "REJECTED"]);
    else throw new Error("Unknown event scope");
    return query;
  }
  return {
    list: (scope, userId) => unwrap(scopedQuery(scope, userId).order("submitted_at", { ascending: false })),
    find: (scope, userId, id) => unwrap(scopedQuery(scope, userId).eq("id", id).maybeSingle()),
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
    decide: (id, status) => unwrap(client.from("events").update({ status })
      .eq("id", id).eq("status", "SUBMITTED").select(FIELDS).maybeSingle()),
    assign(id, coordinatorId, expectedCoordinatorId) {
      let query = client.from("events").update({ coordinator_id: coordinatorId })
        .eq("id", id).in("status", ["ACCEPTED", "APPROVED"]);
      query = expectedCoordinatorId === null ? query.is("coordinator_id", null) : query.eq("coordinator_id", expectedCoordinatorId);
      return unwrap(query.select(FIELDS).maybeSingle());
    },
    publish: (id) => unwrap(client.from("events").update({ status: "APPROVED" })
      .eq("id", id).eq("status", "ACCEPTED").not("coordinator_id", "is", null).select(FIELDS).maybeSingle()),
  };
}

module.exports = { createEventWorkspaceService };
