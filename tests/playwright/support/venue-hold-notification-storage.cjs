const { randomUUID } = require('node:crypto');

// SCRUM-163: storage boundary only; real lifecycle SQL and locking have independent PostgreSQL checks.
module.exports = function venueHoldNotificationStorage(venues, data, pending, auth) {
  const states = [], clocks = new Map();
  let preparing = false;
  const nowFor = owner => clocks.get(owner) ?? Date.now();
  const eventFor = async id => (await data.from('events').select('*').eq('id', id).maybeSingle()).data;
  const openEvent = event => event && ['APPROVED', 'CONFIRMED'].includes(event.status) && !event.cancelled_at;
  const create = venues.createHold.bind(venues);
  venues.createHold = async (...args) => {
    const rows = await create(...args);
    const venue = await venues.getVenueById(args[0]);
    const event = await eventFor(args[1].event_id);
    for (const row of rows) if (row.event_id && row.coordinator_id && row.expires_at && event) {
      states.push({ id: randomUUID(), row, venueName: venue.name, eventName: event.name, endedAt: null, expiring: null, expired: null });
    }
    return rows;
  };
  const syncEnded = () => { for (const state of states) if (state.row.status !== 'hold' && state.endedAt === null) state.endedAt = nowFor(state.row.coordinator_id); };
  const decide = venues.decideBookingRequest.bind(venues);
  venues.decideBookingRequest = async (...args) => { const result = await decide(...args); syncEnded(); return result; };
  const active = row => row.status === 'hold' && Date.parse(row.expires_at) > nowFor(row.coordinator_id);
  const listHolds = venues.listHolds.bind(venues);
  venues.listHolds = async id => (await listHolds(id)).filter(row => row.status === 'hold');
  // Clock controls affect stored-hold reads too, so expiry tests cannot merely fabricate a notification.
  venues.listActiveHoldsInRange = async (id, from, to) => (await venues.listHolds(id))
    .filter(row => row.booking_date >= from && row.booking_date <= to && active(row))
    .map(row => ({ booking_date: row.booking_date, slot: row.slot, event_name: row.event_name }));
  const getActive = venues.getActiveHoldsByIds.bind(venues);
  venues.getActiveHoldsByIds = async ids => (await getActive(ids)).filter(row => {
    const state = states.find(item => item.row.id === row.id);
    return !state || active(state.row);
  });
  const eligible = venues.listEligibleHoldsForCoordinator.bind(venues);
  venues.listEligibleHoldsForCoordinator = async (...args) => (await eligible(...args)).map(group => ({ ...group,
    slots: group.slots.filter(slot => { const state = states.find(item => item.row.id === slot.id); return !state || active(state.row); }),
  })).filter(group => group.slots.length);
  auth.post('/__test/venue-hold-time/:coordinatorId', (req, res) => {
    const time = Date.parse(req.body.now);
    if (!Number.isFinite(time)) return res.sendStatus(400);
    clocks.set(req.params.coordinatorId, time);
    res.sendStatus(204);
  });
  const due = (state, phase) => {
    const deadline = Date.parse(state.row.expires_at), now = nowFor(state.row.coordinator_id);
    return phase === 'expiring' ? state.endedAt === null && deadline > now && deadline <= now + 3600000
      : deadline <= now && (state.endedAt === null || state.endedAt >= deadline);
  };
  return {
    async prepareVenueHolds() {
      if (preparing) return 0;
      preparing = true;
      let count = 0;
      try {
        syncEnded();
        for (const phase of ['expiring', 'expired']) {
          const groups = new Map();
          for (const state of states.filter(item => item[phase] === null && due(item, phase))) {
            const row = state.row;
            const key = JSON.stringify([row.venue_id, row.event_id, row.coordinator_id, row.booking_date, row.created_at, row.expires_at]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(state);
          }
          for (const group of groups.values()) {
            const event = await eventFor(group[0].row.event_id);
            if (!openEvent(event)) continue;
            const selected = group.filter(state => state[phase] === null && due(state, phase));
            if (!selected.length) continue;
            const first = selected[0], row = first.row, id = randomUUID();
            const timestamp = new Date(row.expires_at).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
            const message = 'Your tentative hold at ' + first.venueName + ' for ' + first.eventName + ' on ' + row.booking_date +
              (phase === 'expiring' ? ' expires at ' : ' expired at ') + timestamp + '.' +
              (phase === 'expiring' ? ' Open venue availability to review it.' : ' The expired reservation has been released.');
            pending.set(id, { id, event_id: row.event_id, recipient_id: row.coordinator_id, lease_token: randomUUID(), workflow: 'venue-hold-expiry',
              payload: { venueId: row.venue_id, venueName: first.venueName, eventId: row.event_id, eventName: first.eventName,
                bookingDate: row.booking_date, expiresAt: row.expires_at, changeType: phase, message,
                requestPath: '/venues/' + row.venue_id + '/availability', stateIds: selected.map(state => state.id) } });
            for (const state of selected) state[phase] = id;
            count++;
          }
        }
      } finally { preparing = false; }
      return count;
    },
    async venueHoldNotificationIsCurrent(delivery) {
      syncEnded();
      const p = delivery.payload, event = await eventFor(p.eventId);
      if (!openEvent(event)) return false;
      return states.some(state => p.stateIds.includes(state.id) && state[p.changeType] === delivery.id &&
        state.row.coordinator_id === delivery.recipient_id && state.row.event_id === p.eventId && state.row.venue_id === p.venueId &&
        state.row.expires_at === p.expiresAt && due(state, p.changeType));
    },
  };
};
