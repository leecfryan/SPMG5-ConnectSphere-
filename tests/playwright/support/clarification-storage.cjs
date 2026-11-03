const { randomUUID } = require('node:crypto');

// Storage substitute only: real identity, guards and service execute above it.
module.exports = (findEvent, client) => async (id, coordinatorId, note) => {
  const event = findEvent(id);
  if (!event || event.status !== 'UNDER_REVIEW' || event.coordinator_id !== coordinatorId) return null;
  const fields = ['name', 'purpose', 'description', 'start_time', 'end_time', 'registration_start', 'registration_end',
    'expected_attendance', 'venue_requirements', 'accessibility_needs', 'equipment_needs', 'other_comments'];
  const cycle = randomUUID();
  client.activity.push({ id: cycle, event_id: id, user_id: coordinatorId, action: 'CHANGES_REQUESTED',
    details: { cycle_id: cycle, from_status: 'UNDER_REVIEW', to_status: 'CHANGES_REQUESTED', note,
      organiser_id: event.organiser_id, coordinator_id: coordinatorId,
      before: Object.fromEntries(fields.map(field => [field, event[field] ?? null])) }, created_at: new Date().toISOString() });
  event.status = 'CHANGES_REQUESTED';
  return { ...event };
};
