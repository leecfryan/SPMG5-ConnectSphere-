const { randomUUID } = require('node:crypto');

// SCRUM-43: test-only storage boundary. Real transition triggers are tested in PostgreSQL.
module.exports = function registrationNotificationStorage(dataClient, pending, auth) {
  const history = [];
  const entries = dataClient.waitlistEntries;
  const eligible = event => event?.status === 'APPROVED' && !event.cancelled_at && event.start_time && Date.parse(event.start_time) > Date.now();
  const eventFor = async id => (await dataClient.from('events').select('*').eq('id', id).maybeSingle()).data;
  const deadlineFor = (entry, event) => new Date(Math.min(Date.parse(entry.offer_expires_at), Date.parse(event.start_time))).toISOString();
  const deadlineText = deadline => new Date(deadline).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  const capture = (table, row, previous) => {
    let kind;
    if (table === 'registrations' && row.status === 'confirmed' && previous?.status !== 'confirmed') kind = 'confirmed';
    if (table === 'event_waitlist_entries' && row.status === 'active') {
      if (row.offer_state === 'offered' && (previous?.offer_state !== 'offered' || previous?.offered_at !== row.offered_at)) kind = 'promoted';
      else if (!previous && row.offer_state !== 'offered') kind = 'waitlisted';
    }
    if (kind) history.push({ id: randomUUID(), row: structuredClone(row), event: eventFor(row.event_id), kind, queued: false, reminder: false, reminderId: randomUUID() });
  };
  dataClient.onRegistrationChange(capture);
  const rpc = dataClient.rpc.bind(dataClient);
  dataClient.rpc = (name, args) => {
    if (!['get_my_waitlist_state', 'enqueue_waitlist_if_full_v2', 'accept_waitlist_offer', 'decline_waitlist_offer'].includes(name)) return rpc(name, args);
    return (async () => {
      const result = data => ({ data, error: null });
      if (name === 'get_my_waitlist_state') {
        const entry = entries.find(row => row.event_id === args.p_event_id && row.attendee_id === args.p_attendee_id && row.status === 'active');
        if (!entry) return result({ outcome: 'not_found' });
        const event = await eventFor(entry.event_id);
        return result({ outcome: 'found', entry, position: 1, server_time: new Date().toISOString(),
          effective_deadline: entry.offer_state === 'offered' ? deadlineFor(entry, event) : null });
      }
      if (name === 'enqueue_waitlist_if_full_v2') {
        const event = await eventFor(args.p_event_id);
        if (!eligible(event)) return result({ outcome: 'event_not_open' });
        if (entries.some(row => row.event_id === event.id && row.attendee_id === args.p_attendee_id && row.status === 'active')) return result({ outcome: 'already_joined' });
        if ((event.enrolled_attendees ?? 0) < event.expected_attendance) return result({ outcome: 'not_full' });
        const row = { id: randomUUID(), event_id: event.id, attendee_id: args.p_attendee_id,
          status: 'active', offer_state: null, registration_data: args.p_registration_data, created_at: new Date().toISOString() };
        entries.push(row); capture('event_waitlist_entries', row);
        return result({ outcome: 'joined', entry: row, position: 1, server_time: new Date().toISOString() });
      }
      if (['accept_waitlist_offer', 'decline_waitlist_offer'].includes(name)) {
        const entry = entries.find(row => row.event_id === args.p_event_id && row.attendee_id === args.p_attendee_id && row.status === 'active' && row.offer_state === 'offered');
        if (!entry) return result({ outcome: 'offer_not_found' });
        const event = await eventFor(entry.event_id);
        if (!eligible(event)) return result({ outcome: 'event_ineligible' });
        if (Date.parse(deadlineFor(entry, event)) <= Date.now()) { entries.splice(entries.indexOf(entry), 1); return result({ outcome: 'expired' }); }
        if (name === 'decline_waitlist_offer') { entries.splice(entries.indexOf(entry), 1); return result({ outcome: 'declined' }); }
        const { data: registration } = await dataClient.from('registrations').insert({
          event_id: event.id, attendee_id: args.p_attendee_id, status: 'confirmed', registration_data: entry.registration_data,
        }).single();
        entries.splice(entries.indexOf(entry), 1);
        return result({ outcome: 'accepted', registration_id: registration.id, server_time: new Date().toISOString() });
      }
    })();
  };
  // Represents an external database offer transition, not a production HTTP endpoint.
  auth.post('/__test/registration-offers/:id', async (req, res) => {
    const row = entries.find(entry => entry.id === req.params.id);
    if (!row) return res.sendStatus(404);
    const previous = { ...row };
    Object.assign(row, { offer_state: 'offered', offered_at: new Date().toISOString(),
      offer_expires_at: req.body.deadline ?? new Date(Date.now() + 86400000).toISOString() });
    capture('event_waitlist_entries', row, previous);
    res.sendStatus(204);
  });
  const enqueue = (change, event, workflow, message, deadline = null) => {
    const reminder = workflow === 'waitlist-offer-expiring';
    const id = reminder ? change.reminderId : change.id;
    pending.set(id, { id, lease_token: randomUUID(), recipient_id: change.row.attendee_id, workflow,
      source_id: change.row.id, offer_started_at: change.row.offered_at,
      payload: { ...(reminder ? { offerChangeId: change.id } : { changeId: change.id }),
        eventId: change.row.event_id, eventName: event.name,
        changeType: reminder ? 'offer-expiring' : change.kind,
        message, requestPath: '/registrations/me', effectiveDeadline: deadline } });
  };
  return {
    async prepareRegistrations() {
      for (const change of history.filter(row => !row.queued)) {
        const event = await change.event;
        const message = change.kind === 'confirmed' ? `Your registration for ${event.name} is confirmed.` :
          change.kind === 'waitlisted' ? `You have joined the waitlist for ${event.name}.` :
            `A place is available for you at ${event.name}. Accept your offer by ${deadlineText(deadlineFor(change.row, event))}.`;
        enqueue(change, event, 'registration-status', message, change.kind === 'promoted' ? deadlineFor(change.row, event) : null);
        change.queued = true;
      }
    },
    async prepareReminders() {
      for (const change of history.filter(row => row.kind === 'promoted' && !row.reminder)) {
        const entry = entries.find(row => row.id === change.row.id && row.offered_at === change.row.offered_at);
        const event = await eventFor(change.row.event_id);
        if (!entry || entry.status !== 'active' || entry.offer_state !== 'offered' || !eligible(event)) continue;
        const deadline = deadlineFor(entry, event);
        const remaining = Date.parse(deadline) - Date.now();
        if (remaining <= 0 || remaining > 3600000) continue;
        enqueue(change, event, 'waitlist-offer-expiring', `Your place offer for ${event.name} expires at ${deadlineText(deadline)}. Open My Registrations to accept or decline.`, deadline);
        change.reminder = true;
      }
    },
    async reminderIsCurrent(row) {
      const change = history.find(change => change.id === row.payload.offerChangeId && change.reminderId === row.id &&
        change.row.attendee_id === row.recipient_id && change.row.event_id === row.payload.eventId);
      const entry = entries.find(entry => entry.id === row.source_id && entry.event_id === row.payload.eventId && entry.attendee_id === row.recipient_id &&
        entry.offered_at === row.offer_started_at && entry.status === 'active' && entry.offer_state === 'offered');
      const event = entry && await eventFor(entry.event_id);
      if (!change || !entry || !eligible(event)) return false;
      const deadline = deadlineFor(entry, event);
      if (deadline !== row.payload.effectiveDeadline) {
        change.reminderId = randomUUID();
        change.reminder = false;
        return false;
      }
      const remaining = Date.parse(deadline) - Date.now();
      return remaining > 0 && remaining <= 3600000;
    },
  };
};
