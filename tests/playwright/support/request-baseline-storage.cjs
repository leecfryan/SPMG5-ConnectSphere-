const { randomUUID } = require('node:crypto');
const { WRITABLE_COLS } = require('../../../backend/src/modules/events/events.repository');

// SCRUM-117: substitutes the baseline trigger only; SQL tests exercise the real trigger.
module.exports = function requestBaselineStorage(client, eventsRepository) {
  let lastTimestamp = 0;
  client.recordRequestBaseline = (event, source = 'SUBMITTED') => {
    lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
    const created_at = new Date(lastTimestamp).toISOString();
    client.activity.push({ id: randomUUID(), event_id: event.id, user_id: null,
      action: 'REQUEST_BASELINE_RECORDED', created_at,
      details: { source, version_at: created_at,
        snapshot: Object.fromEntries(WRITABLE_COLS.map(field => [field, event[field] ?? null])) } });
  };
  if (eventsRepository) for (const name of ['createSubmitted', 'markSubmitted']) {
    const write = eventsRepository[name].bind(eventsRepository);
    eventsRepository[name] = async (...args) => {
      const event = await write(...args);
      if (event) client.recordRequestBaseline(event);
      return event;
    };
  }
};
