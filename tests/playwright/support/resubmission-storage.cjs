const { randomUUID } = require('node:crypto');
const FIELDS = ['name', 'purpose', 'description', 'start_time', 'end_time', 'registration_start', 'registration_end',
  'expected_attendance', 'venue_requirements', 'accessibility_needs', 'equipment_needs', 'other_comments'];
const snapshot = event => Object.fromEntries(FIELDS.map(field => [field, event[field] ?? null]));
const comparable = (field, value) => value == null || value === '' ? null :
  ['start_time', 'end_time', 'registration_start', 'registration_end'].includes(field) ? new Date(value).toISOString() : value;

// SCRUM-117: substitute RPC persistence only; SQL tests verify the real transaction.
module.exports = function resubmissionStorage(client, pending) {
  if (!client.recordRequestBaseline) require('./request-baseline-storage.cjs')(client);
  const rpc = client.rpc.bind(client);
  client.rpc = (name, args) => {
    if (name !== 'resubmit_event_request') return rpc(name, args);
    return {
      select() { return this; },
      async maybeSingle() {
        const { data: event } = await client.from('events').select('*').eq('id', args.p_event_id).maybeSingle();
        const cycle = client.activity.filter(row => row.event_id === args.p_event_id && row.action === 'CHANGES_REQUESTED').at(-1);
        const baseline = client.activity.filter(row => row.event_id === args.p_event_id && row.action === 'REQUEST_BASELINE_RECORDED').at(-1);
        if (!baseline || !event || event.organiser_id !== args.p_organiser_id || event.status !== 'CHANGES_REQUESTED' || !event.coordinator_id ||
          !cycle || cycle.id !== args.p_cycle_id || cycle.details.coordinator_id !== event.coordinator_id ||
          FIELDS.some(field => comparable(field, event[field]) !== comparable(field, args.p_expected_fields[field]))) return { data: null, error: null };
        const after = snapshot(event), before = snapshot(baseline.details.snapshot);
        const changes = FIELDS.filter(field => comparable(field, before[field]) !== comparable(field, after[field]))
          .map(field => ({ field, before: before[field], after: after[field] }));
        const id = randomUUID();
        client.activity.push({ id, event_id: event.id, user_id: args.p_organiser_id, action: 'REQUEST_RESUBMITTED',
          created_at: new Date().toISOString(), details: { cycle_id: cycle.id, from_status: 'CHANGES_REQUESTED', to_status: 'UNDER_REVIEW',
            organiser_id: event.organiser_id, coordinator_id: event.coordinator_id, before, after, changes, baseline_source: baseline.details.source } });
        pending.set(id, { id, lease_token: randomUUID(), recipient_id: event.coordinator_id, workflow: 'event-request-resubmitted',
          payload: { eventId: event.id, cycleId: cycle.id, eventName: event.name, changedFieldCount: changes.length, requestPath: '/assigned-events/' + event.id } });
        const saved = await client.from('events').update({ status: 'UNDER_REVIEW' }).eq('id', event.id).select('*').maybeSingle();
        client.recordRequestBaseline(saved.data, 'RESUBMITTED');
        return saved;
      },
    };
  };
};
