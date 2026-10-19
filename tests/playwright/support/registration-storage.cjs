// Test-only Supabase query adapter; uses the event submission fixture's records.
const { randomUUID } = require('node:crypto');
module.exports = function registrationStorage(accounts) {
  const registrations = [];
  const waitlistEntries = [];
  // SCRUM-141: event activity history, written by the events fixture in server.cjs.
  const activity = [];
  const events = () => [...accounts.values()].flatMap(account => account.events);
  function project(row, selection) {
    if (!selection || selection === '*') return { ...row };
    const fields = selection.replace(/events\([^)]*\)/, '').split(',').map(field => field.trim()).filter(Boolean);
    const value = Object.fromEntries(fields.map(field => [field, row[field]]));
    const joined = /events\(([^)]*)\)/.exec(selection);
    if (joined) value.events = project(events().find(event => event.id === row.event_id) || {}, joined[1]);
    return value;
  }
  return {
    registrations,
    activity,
    async rpc(name, args) {
      if (name === 'registration_availability_for_events') {
        const availability = args.p_event_ids.map(eventId => {
          const event = events().find(candidate => candidate.id === eventId);
          if (!event) return null;
          const capacity = event.expected_attendance;
          const enrolled = event.enrolled_attendees ?? 0;
          return {
            event_id: eventId,
            slots_remaining: capacity == null ? null : Math.max(0, capacity - enrolled),
            waitlist_queue_count: 0,
            waitlist_reserved: 0,
          };
        }).filter(Boolean);
        return { data: availability, error: null };
      }
      if (name === 'claim_registration_seat_v2') {
        const event = events().find(candidate => candidate.id === args.p_event_id);
        if (!event) return { data: { outcome: 'event_not_found' }, error: null };
        if (event.status !== 'APPROVED') return { data: { outcome: 'event_not_open' }, error: null };
        const now = Date.now();
        if (event.registration_start && now < Date.parse(event.registration_start)) {
          return { data: { outcome: 'registration_not_open' }, error: null };
        }
        if (event.registration_end && now > Date.parse(event.registration_end)) {
          return { data: { outcome: 'registration_closed' }, error: null };
        }
        const enrolled = event.enrolled_attendees ?? 0;
        if (event.expected_attendance != null && enrolled >= event.expected_attendance) {
          return { data: { outcome: 'full' }, error: null };
        }
        event.enrolled_attendees = enrolled + 1;
        return {
          data: { outcome: 'claimed', enrolled_attendees: event.enrolled_attendees },
          error: null,
        };
      }
      if (name === 'reconcile_event_waitlist') {
        return { data: { outcome: 'reconciled' }, error: null };
      }
      if (name === 'get_my_waitlist_state') {
        return {
          data: { outcome: 'not_found', server_time: new Date().toISOString() },
          error: null,
        };
      }
      throw new Error(`Unsupported registration fixture RPC: ${name}`);
    },
    from(table) {
      const filters = [];
      let selection = '*', insertion, update, ordering;
      function execute(single) {
        const rows = table === 'events'
          ? events()
          : table === 'event_waitlist_entries'
            ? waitlistEntries
            : table === 'event_activity_log'
              ? activity
              : registrations;
        let result = rows.filter(row => filters.every(test => test(row)));
        if (insertion) {
          if (rows.some(row => row.attendee_id === insertion.attendee_id && row.event_id === insertion.event_id)) {
            return { data: null, error: { code: '23505', message: 'Duplicate registration' } };
          }
          const now = new Date().toISOString();
          const row = { ...insertion, id: randomUUID(), created_at: now, updated_at: now };
          rows.push(row); result = [row];
        }
        if (update) result.forEach(row => Object.assign(row, update, { updated_at: new Date().toISOString() }));
        if (ordering) result.sort((a, b) => String(a[ordering.key]).localeCompare(String(b[ordering.key])) * (ordering.ascending ? 1 : -1));
        const data = result.map(row => project(row, selection));
        return { data: single ? data[0] || null : data, error: null };
      }
      const query = {
        select(fields = '*') { selection = fields; return query; },
        is(key, value) { filters.push(row => (row[key] ?? null) === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        not(key, operator, value) { if (operator !== 'is' || value !== null) throw new Error('Unsupported filter'); filters.push(row => row[key] != null); return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        neq(key, value) { filters.push(row => row[key] !== value); return query; },
        order(key, { ascending = true } = {}) { ordering = { key, ascending }; return query; },
        insert(value) { insertion = value; return query; },
        update(value) { update = value; return query; },
        single() { return Promise.resolve(execute(true)); },
        maybeSingle() { return Promise.resolve(execute(true)); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };
      return query;
    },
  };
};
