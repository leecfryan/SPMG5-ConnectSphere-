// Test-only storage. Production auth, venue controllers and validation stay real.
const { randomUUID } = require('node:crypto');
const { committedSlots } = require('../../../backend/src/modules/venues/venues.availability');
const venueId = '11111111-1111-4111-8111-111111111111';
module.exports = function venueStorage(accounts) {
  let venue = { id: venueId, name: 'Integration Hall', address: '1 Test Street', city: 'Singapore', country: 'Singapore',
    capacity: 200, facilities: ['Projector'], accessibility_features: ['Lift'], room_layouts: ['Theatre'], is_active: true,
    operating_hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, { open: '08:00', close: '23:00' }])),
    setup_minutes: 15, teardown_minutes: 15, turnaround_minutes: 15, notes: '' };
  const requests = [];
  // SCRUM-133: in-memory unavailability periods for Playwright fixtures
  const periods = [];
  // SCRUM-146: in-memory holds for Playwright fixtures
  const holds = [];
  const events = () => [...accounts.values()].flatMap(account => account.events);
  const visible = (request, scope) => scope?.allVenues || (scope?.coordinatorId && events().some(event => event.id === request.event_id && event.coordinator_id === scope.coordinatorId));
  function eachDateInRange(from, to) {
    const dates = [];
    const toMs = new Date(to).getTime();
    for (let d = new Date(from); d.getTime() <= toMs; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }
  return {
    async listVenues({ city, minCapacity }) { return (!city || venue.city.toLowerCase().includes(city.toLowerCase())) && (!minCapacity || venue.capacity >= minCapacity) ? [venue] : []; },
    async getVenueById(id) { return id === venue.id ? venue : null; },
    async updateVenue(id, changes) { if (id !== venue.id) return null; venue = { ...venue, ...changes }; return venue; },
    async listBookingsInRange(id, from, to) { return requests.filter(r => r.venue.id === id && r.booking_date >= from && r.booking_date <= to).flatMap(r => r.slots.map(slot => ({ ...slot, booking_date: r.booking_date, event_name: r.event.name }))); },
    async listUnavailabilityInRange(id, from, to) {
      // SCRUM-133: expand in-memory periods into per-slot rows
      const expanded = periods
        .filter(p => p.venue_id === id && p.start_date <= to && p.end_date >= from)
        .flatMap(p => eachDateInRange(p.start_date, p.end_date)
          .filter(date => date >= from && date <= to)
          .flatMap(date => p.slots.map(slot => ({ unavailable_date: date, slot, reason: p.reason }))));
      return expanded;
    },
    async getEventById(id, coordinatorId) { return events().find(event => event.id === id && event.coordinator_id === coordinatorId) || null; },
    // SCRUM-138: the event behind a check report, under the same scope rule as
    // the real service — a coordinator sees only their own event, staff see all.
    async getEventForCheckReport(id, scope) { return events().find(event => event.id === id && (scope?.allVenues === true || event.coordinator_id === scope?.coordinatorId)) || null; },
    async listBookableEvents(coordinatorId) { return events().filter(event => event.coordinator_id === coordinatorId && ['APPROVED', 'CONFIRMED'].includes(event.status)); },
    async listSlotRowsForDate(id, date) { return requests.filter(r => r.venue.id === id && r.booking_date === date).flatMap(r => r.slots.map(slot => ({ ...slot, booking_date: date, event_name: r.event.name, request: { id: r.id, event_id: r.event_id } }))); },
    async submitBookingRequest(id, name, value, requesterId) {
      const event = events().find(event => event.id === value.event_id && event.coordinator_id === requesterId);
      if (!event) throw new Error('Fixture assignment denied');
      const request = { ...value, id: randomUUID(), requested_by: requesterId, venue, event,
        submitted_at: new Date().toISOString(), slots: value.slots.map(slot => ({ slot, status: 'pending' })) };
      requests.push(request);
      return request.id;
    },
    async getBookingRequestById(id, scope) { return requests.find(r => r.id === id && visible(r, scope)) || null; },
    async listBookingRequests(scope, eventId) { return requests.filter(r => visible(r, scope) && (!eventId || r.event_id === eventId)); },
    // SCRUM-136: mirrors the production read-only affected-booking query for
    // unavailability periods, including setup and turnaround buffer slots.
    async listAffectedBookingRequests(id, period, venueDetail) {
      const unavailableSlots = new Set(period.slots);
      return requests.filter((request) => {
        if (request.venue.id !== id || request.booking_date < period.start_date || request.booking_date > period.end_date) return false;
        const confirmedSlots = request.slots.filter((slot) => slot.status === 'confirmed').map((slot) => slot.slot);
        return committedSlots(confirmedSlots, venueDetail.setup_minutes, venueDetail.turnaround_minutes)
          .some((slot) => unavailableSlots.has(slot));
      });
    },
    // SCRUM-145: the browser fixture must preserve the production route's
    // affected state so a failed booking check does not produce a test-server 500.
    async markVenueBookingAffected(id, userId, reason, isVenueStaff) {
      const request = requests.find(item => item.id === id);
      if (!request || (!isVenueStaff && request.event.coordinator_id !== userId)) return null;
      request.is_affected = true;
      request.affected_reason = reason;
      request.affected_at = new Date().toISOString();
      if (request.event.status === 'CONFIRMED') request.event.status = 'APPROVED';
      return id;
    },
    // Same rule as decide_venue_booking_request: coordinator-cancelled slots stay cancelled.
    // SCRUM-162: on confirmed, cancel linked holds so the calendar clears the tentative marker.
    async decideBookingRequest(id, decision) {
      const r = requests.find(r => r.id === id);
      if (!r) return null;
      for (const slot of r.slots) if (slot.status !== 'cancelled') slot.status = decision;
      if (decision === 'confirmed') {
        for (const hold of holds) { if (hold.request_id === id) hold.status = 'cancelled'; }
      }
      return id;
    },
    // SCRUM-148/149: mirror the production release RPC for cancellation and postponement.
    async releaseBookingsForCancelledEvent(eventId) {
      let released = 0;
      for (const request of requests.filter(r => r.event_id === eventId)) {
        for (const slot of request.slots) {
          if (!['pending', 'confirmed'].includes(slot.status)) continue;
          slot.status = 'cancelled';
          released += 1;
        }
      }
      return released;
    },
    // SCRUM-133: unavailability period CRUD
    async createUnavailabilityPeriod(venueId, data, createdBy) {
      const period = { ...data, id: randomUUID(), venue_id: venueId, created_by: createdBy,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      periods.push(period);
      return period;
    },
    async listUnavailabilityPeriods(venueId) {
      return periods.filter(p => p.venue_id === venueId).sort((a, b) => a.start_date.localeCompare(b.start_date));
    },
    async getUnavailabilityPeriodById(periodId, venueId) {
      return periods.find(p => p.id === periodId && p.venue_id === venueId) || null;
    },
    async updateUnavailabilityPeriod(periodId, venueId, changes) {
      const idx = periods.findIndex(p => p.id === periodId && p.venue_id === venueId);
      if (idx === -1) return null;
      periods[idx] = { ...periods[idx], ...changes, updated_at: new Date().toISOString() };
      return periods[idx];
    },
    async deleteUnavailabilityPeriod(periodId, venueId) {
      const idx = periods.findIndex(p => p.id === periodId && p.venue_id === venueId);
      if (idx === -1) return null;
      const [removed] = periods.splice(idx, 1);
      return { id: removed.id };
    },
    // SCRUM-146: tentative holds
    async listActiveHoldsInRange(id, from, to) {
      const now = new Date().toISOString();
      return holds.filter(h => h.venue_id === id && h.booking_date >= from && h.booking_date <= to && h.expires_at > now && h.status !== 'cancelled')
        .map(h => ({ booking_date: h.booking_date, slot: h.slot, event_name: h.event_name }));
    },
    async listHolds(id) {
      return holds.filter(h => h.venue_id === id)
        .sort((a, b) => b.booking_date.localeCompare(a.booking_date) || b.created_at.localeCompare(a.created_at));
    },
    async createHold(id, { event_name, event_id, booking_date, slots, expires_at, coordinator_id }, heldBy) {
      const now = new Date().toISOString();
      const rows = slots.map(slot => ({ id: randomUUID(), venue_id: id, booking_date, slot, event_name, event_id: event_id || null, coordinator_id: coordinator_id || null, requested_by: heldBy, expires_at, status: 'hold', created_at: now }));
      holds.push(...rows);
      return rows;
    },
    // SCRUM-162: events with assigned coordinators for the hold placement form.
    // Restricted to APPROVED/CONFIRMED — holds can only be placed for events
    // that are eligible for booking conversion.
    async listEventsWithCoordinator() {
      const now = new Date().toISOString();
      return events()
        .filter(e => e.coordinator_id && ['APPROVED', 'CONFIRMED'].includes(e.status) && e.start_time && e.end_time > now)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
    },
    // SCRUM-162: eligible holds for a coordinator — matched by event_id
    async listEligibleHoldsForCoordinator(venueId, coordinatorId) {
      const now = new Date().toISOString();
      const bookableEvents = events().filter(e => e.coordinator_id === coordinatorId && ['APPROVED', 'CONFIRMED'].includes(e.status));
      const eventsById = new Map(bookableEvents.map(e => [e.id, e]));
      const activeHolds = holds.filter(h => h.venue_id === venueId && h.coordinator_id === coordinatorId && h.expires_at > now && !h.request_id && h.status !== 'cancelled');
      function localDate(instant) {
        return new Date(instant).toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
      }
      const groups = new Map();
      for (const hold of activeHolds) {
        const event = hold.event_id ? eventsById.get(hold.event_id) : null;
        if (!event) continue;
        if (event.start_time && event.end_time) {
          const startDate = localDate(event.start_time);
          const endDate = localDate(event.end_time);
          if (hold.booking_date < startDate || hold.booking_date > endDate) continue;
        }
        const key = `${hold.event_id}|${hold.booking_date}`;
        if (!groups.has(key)) groups.set(key, { event, booking_date: hold.booking_date, slots: [] });
        groups.get(key).slots.push({ id: hold.id, slot: hold.slot, expires_at: hold.expires_at });
      }
      return Array.from(groups.values());
    },
    // SCRUM-162: fetch active hold rows by id for conversion validation
    async getActiveHoldsByIds(holdIds) {
      const now = new Date().toISOString();
      return holds
        .filter(h => holdIds.includes(h.id) && h.expires_at > now && !h.request_id)
        .map(h => ({ id: h.id, venue_id: h.venue_id, booking_date: h.booking_date, slot: h.slot, event_name: h.event_name, event_id: h.event_id, coordinator_id: h.coordinator_id }));
    },
    // SCRUM-162: link holds to the created booking request so approval can cancel them
    async linkHoldsToRequest(holdIds, requestId) {
      for (const hold of holds) {
        if (holdIds.includes(hold.id)) hold.request_id = requestId;
      }
    },
    // SCRUM-135: no-op for test fixture - recheckConflictsAfterUpdate is called after
    // venue updates but the fake storage doesn't track conflict flags
    async recheckConflictsAfterUpdate() {
      return;
    },
  };
};
