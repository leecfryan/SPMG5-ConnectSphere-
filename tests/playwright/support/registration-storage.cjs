// Test-only Supabase query adapter; uses the event submission fixture's records.
const { randomUUID } = require('node:crypto');
module.exports = function registrationStorage(accounts) {
  const registrations = [];
  const waitlistEntries = [];
  // SCRUM-141: event activity history, written by the events fixture in server.cjs.
  const activity = [];
  // SCRUM-165: notification queue; separate from registrations so tests can inspect it.
  const notificationOutbox = [];
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
    notificationOutbox,
    // SCRUM-37: no longer async - apply_organiser_event_edit below returns a
    // chainable object (select/maybeSingle), matching how the real Supabase
    // client's .rpc() works for a function that returns a table/row type.
    // Every other case here still returns a plain {data, error} object, which
    // `await`ing a non-promise value resolves to unchanged.
    rpc(name, args) {
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
      // SCRUM-37: the fixture only simulates the field write (the one thing
      // every fake Supabase caller in these tests can intercept/fail via
      // .from('events').update(...)) - the real function's significance
      // check, flagging and SUBMITTED regression are SQL-only and proven
      // against the real schema, not re-implemented here. Returns a
      // chainable object, not a resolved promise, matching how the real
      // Supabase client's .rpc(...) supports .select().maybeSingle() chained
      // on afterwards (same shape assign_event_coordinator uses above it in
      // assignment-notification-storage.cjs) - updateOrganiserEvent relies
      // on exactly that chain.
      if (name === 'apply_organiser_event_edit') {
        const self = this;
        return {
          select() { return this; },
          async maybeSingle() {
            // SCRUM-37 reviewer feedback (PR #60): same optimistic-concurrency
            // check the real function makes under its row lock - a stale
            // p_expected_updated_at means another save (e.g. a second open
            // tab) committed first, so this one is refused rather than
            // merged over it.
            const existing = await self.from('events').select('updated_at')
              .eq('id', args.p_event_id).eq('organiser_id', args.p_organiser_id).maybeSingle();
            if (!existing.data) return { data: null, error: { code: 'P0002', message: 'EVENT_NOT_FOUND' } };
            if (existing.data.updated_at !== args.p_expected_updated_at) {
              return { data: null, error: { code: 'P0004', message: 'EVENT_MODIFIED' } };
            }
            const result = await self.from('events').update({
              name: args.p_name, purpose: args.p_purpose, description: args.p_description,
              start_time: args.p_start_time, end_time: args.p_end_time,
              registration_start: args.p_registration_start, registration_end: args.p_registration_end,
              expected_attendance: args.p_expected_attendance, venue_requirements: args.p_venue_requirements,
              accessibility_needs: args.p_accessibility_needs, equipment_needs: args.p_equipment_needs,
              other_comments: args.p_other_comments,
            }).eq('id', args.p_event_id).eq('organiser_id', args.p_organiser_id).select('*').maybeSingle();
            if (result.error) return result;
            if (!result.data) return { data: null, error: { code: 'P0002', message: 'EVENT_NOT_FOUND' } };
            return result;
          },
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
              : table === 'notification_outbox'
                ? notificationOutbox
                : registrations;
        let result = rows.filter(row => filters.every(test => test(row)));
        if (insertion) {
          if (insertion.attendee_id !== undefined && rows.some(row => row.attendee_id === insertion.attendee_id && row.event_id === insertion.event_id)) {
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
