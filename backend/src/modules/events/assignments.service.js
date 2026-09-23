function createAssignmentsService({ repository, directory }) {
  async function listQueue() {
    return { ok: true, events: await repository.findSubmittedUnassigned() };
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

  async function assign(eventId, coordinatorId) {
    if (typeof coordinatorId !== "string" || coordinatorId.trim() === "") {
      return { ok: false, reason: "invalid_coordinator" };
    }

    const coordinators = await directory.listCoordinators();
    if (!coordinators.some((coordinator) => coordinator.id === coordinatorId)) {
      return { ok: false, reason: "unknown_coordinator" };
    }

    const event = await repository.assignCoordinator(eventId, coordinatorId);
    if (event) return { ok: true, event };

    const existing = await repository.findById(eventId);
    return { ok: false, reason: existing ? "conflict" : "not_found" };
  }

  return { listQueue, listCoordinators, assign };
}

module.exports = { createAssignmentsService };
