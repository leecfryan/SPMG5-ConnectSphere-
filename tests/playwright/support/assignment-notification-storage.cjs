const { randomUUID } = require('node:crypto');

// SCRUM-155: substitutes only database RPC storage; production routes and worker still run.
module.exports = function assignmentNotificationStorage(dataClient, pending) {
  const history = [];
  const rpc = dataClient.rpc.bind(dataClient);
  dataClient.rpc = (name, args) => {
    if (name !== 'assign_event_coordinator') return rpc(name, args);
    return {
      select() { return this; },
      async maybeSingle() {
        const { data: event } = await dataClient.from('events').select('*').eq('id', args.p_event_id).maybeSingle();
        if (!event || !args.p_allowed_statuses.includes(event.status) ||
            (event.coordinator_id ?? null) !== args.p_expected_coordinator_id) return { data: null, error: null };
        if (!args.p_actor_id || !args.p_actor_name?.trim()) throw new Error('Assignment identity is required.');
        if (event.coordinator_id === args.p_coordinator_id) return { data: event, error: null };
        const saved = await dataClient.from('events').update({ coordinator_id: args.p_coordinator_id })
          .eq('id', event.id).select('*').maybeSingle();
        history.push({ id: randomUUID(), eventId: event.id, eventName: event.name,
          incoming: args.p_coordinator_id, outgoing: event.coordinator_id,
          assignedById: args.p_actor_id, assignedByName: args.p_actor_name.trim(), queued: false });
        return saved;
      },
    };
  };
  return async function prepareAssignments() {
    for (const change of history.filter(row => !row.queued)) {
      for (const recipient of [change.incoming, change.outgoing].filter(Boolean)) {
        const id = randomUUID();
        pending.set(id, { id, lease_token: randomUUID(), recipient_id: recipient, workflow: 'event-assignment',
          payload: { assignmentChangeId: change.id, eventId: change.eventId, eventName: change.eventName,
            assignedById: change.assignedById, assignedByName: change.assignedByName,
            assignmentType: recipient === change.outgoing ? 'reassigned-away' : change.outgoing ? 'reassigned' : 'assigned' } });
      }
      change.queued = true;
    }
  };
};
