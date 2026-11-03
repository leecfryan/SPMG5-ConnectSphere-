function createAssignmentsService({ repository, directory }) {
  // SCRUM-159 AC2: each request carries its organiser's name. The Lead needs
  // the name, not the internal account id, so organiser_id stays server-side.
  async function listQueue() {
    const rows = await repository.findSubmittedUnassigned();
    const organiserIds = [...new Set(rows.map((row) => row.organiser_id).filter(Boolean))];
    const names = new Map(await Promise.all(
      organiserIds.map(async (id) => [id, await directory.displayNameOf(id)]),
    ));
    return {
      ok: true,
      events: rows.map(({ organiser_id: organiserId, ...event }) => ({
        ...event,
        organiser_name: names.get(organiserId) ?? null,
      })),
    };
  }

  async function listCoordinators() {
    const [coordinators, assignments] = await Promise.all([
      directory.listCoordinators(),
      repository.findActiveAssignments(),
    ]);

    const counts = new Map();
    const earliest = new Map();
    for (const row of assignments) {
      const id = row.coordinator_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      const starts = Date.parse(row.start_time);
      if (!Number.isNaN(starts) && starts < (earliest.get(id) ?? Infinity)) {
        earliest.set(id, starts);
      }
    }

    return {
      ok: true,
      coordinators: coordinators.map((coordinator) => ({
        ...coordinator,
        activeEvents: counts.get(coordinator.id) ?? 0,
        nextEventStart: earliest.has(coordinator.id)
          ? new Date(earliest.get(coordinator.id)).toISOString()
          : null,
      })),
    };
  }

  async function assign(eventId, coordinatorId, actor) {
    if (typeof coordinatorId !== "string" || coordinatorId.trim() === "") {
      return { ok: false, reason: "invalid_coordinator" };
    }

    const coordinators = await directory.listCoordinators();
    if (!coordinators.some((coordinator) => coordinator.id === coordinatorId)) {
      return { ok: false, reason: "unknown_coordinator" };
    }

    const event = await repository.assignCoordinator(eventId, coordinatorId, actor);
    if (event) return { ok: true, event };

    const existing = await repository.findById(eventId);
    return { ok: false, reason: existing ? "conflict" : "not_found" };
  }

  return { listQueue, listCoordinators, assign };
}

module.exports = { createAssignmentsService };
