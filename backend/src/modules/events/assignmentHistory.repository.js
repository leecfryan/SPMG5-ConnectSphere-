function assignWithHistory(client, { eventId, coordinatorId, expectedCoordinatorId, allowedStatuses, actor }) {
  // SCRUM-155: actor comes from requireAuth, never from assignment request fields.
  return client.rpc("assign_event_coordinator", {
    p_event_id: eventId,
    p_coordinator_id: coordinatorId,
    p_expected_coordinator_id: expectedCoordinatorId,
    p_allowed_statuses: allowedStatuses,
    p_actor_id: actor.id,
    p_actor_name: actor.fullName?.trim() || actor.email || actor.id,
  });
}

module.exports = { assignWithHistory };
