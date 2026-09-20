// Test-only storage. Production auth, venue controllers and validation stay real.
const { randomUUID } = require('node:crypto');
const venueId = '11111111-1111-4111-8111-111111111111';
module.exports = function venueStorage(accounts) {
  let venue = { id: venueId, name: 'Integration Hall', address: '1 Test Street', city: 'Singapore', country: 'Singapore',
    capacity: 200, facilities: ['Projector'], accessibility_features: ['Lift'], room_layouts: ['Theatre'], is_active: true,
    operating_hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, { open: '08:00', close: '23:00' }])),
    setup_minutes: 15, teardown_minutes: 15, turnaround_minutes: 15, notes: '' };
  const requests = [];
  const events = () => [...accounts.values()].flatMap(account => account.events);
  const visible = (request, scope) => scope?.allVenues || (scope?.coordinatorId && events().some(event => event.id === request.event_id && event.coordinator_id === scope.coordinatorId));
  return {
    async listVenues({ city, minCapacity }) { return (!city || venue.city.toLowerCase().includes(city.toLowerCase())) && (!minCapacity || venue.capacity >= minCapacity) ? [venue] : []; },
    async getVenueById(id) { return id === venue.id ? venue : null; },
    async updateVenue(id, changes) { if (id !== venue.id) return null; venue = { ...venue, ...changes }; return venue; },
    async listBookingsInRange(id, from, to) { return requests.filter(r => r.venue.id === id && r.booking_date >= from && r.booking_date <= to).flatMap(r => r.slots.map(slot => ({ ...slot, booking_date: r.booking_date, event_name: r.event.name }))); },
    async listUnavailabilityInRange() { return []; },
    async getEventById(id, coordinatorId) { return events().find(event => event.id === id && event.coordinator_id === coordinatorId) || null; },
    async listBookableEvents(coordinatorId) { return events().filter(event => event.coordinator_id === coordinatorId && event.status !== 'DRAFT'); },
    async listSlotRowsForDate(id, date) { return requests.filter(r => r.venue.id === id && r.booking_date === date).flatMap(r => r.slots.map(slot => ({ ...slot, booking_date: date, event_name: r.event.name, request: { event_id: r.event_id } }))); },
    async submitBookingRequest(id, name, value, requesterId) {
      const event = events().find(event => event.id === value.event_id && event.coordinator_id === requesterId);
      if (!event) throw new Error('Fixture assignment denied');
      const request = { ...value, id: randomUUID(), requested_by: requesterId, venue, event,
        submitted_at: new Date().toISOString(), slots: value.slots.map(slot => ({ slot, status: 'pending' })) };
      requests.push(request);
      return request.id;
    },
    async getBookingRequestById(id, scope) { return requests.find(r => r.id === id && visible(r, scope)) || null; },
    async listBookingRequests(scope) { return requests.filter(r => visible(r, scope)); },
  };
};
