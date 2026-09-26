// Only used by local Playwright servers, never by production startup.
const { randomUUID } = require('node:crypto');
module.exports = function equipmentStorage(accounts) {
  const requests = [];
  const messages = [];
  const events = () => [...accounts.values()].flatMap(account => account.events);
  const equipment = () => [...accounts.values()].map(account => ({ id: account.id, type: 'Projector ' + account.id, current_location: 'Singapore' }));
  const equipmentService = {
    async listEquipment() { return equipment(); },
    async findEquipmentById(id) { return equipment().find(item => item.id === id) || null; },
    async listRequestsByEvent(id) { return requests.filter(row => row.event_id === id); },
    async findRequestById(id) { return requests.find(row => row.id === id) || null; },
    async listAllRequests() { return requests; },
    async hasOverlappingRequest(id, start, end) { return requests.some(row => row.equipment_id === id && row.status !== 'REJECTED' && row.borrow_start < end && row.borrow_end > start); },
    async createRequest(fields, requestedBy) {
      const row = { ...fields, id: randomUUID(), requested_by: requestedBy, status: 'PENDING', created_at: new Date().toISOString() };
      requests.push(row);
      return row;
    },
    async updateStatus(id, status) { const row = requests.find(row => row.id === id); if (!row) return null; row.status = status; return row; },
  };
  return {
    equipmentService,
    messagesService: {
      async listByEquipmentRequestIds(ids) { return messages.filter(row => ids.includes(row.equipment_request_id) && !row.deleted_at); },
      async findById(id) { return messages.find(row => row.id === id && !row.deleted_at) || null; },
      async create(fields, authorId, authorRole) {
        const row = { ...fields, id: randomUUID(), author_id: authorId, author_role: authorRole, created_at: new Date().toISOString(), updated_at: null };
        messages.push(row);
        return row;
      },
      async updateBody(id, body) { const row = messages.find(row => row.id === id); if (!row) return null; row.body = body; row.updated_at = new Date().toISOString(); return row; },
    },
    async findEventById(id) { return events().find(event => event.id === id) || null; },
    async findEventsByIds(ids) { return events().filter(event => ids.includes(event.id)); },
    async listAssignedEvents(id) { return events().filter(event => event.coordinator_id === id && ['ACCEPTED', 'APPROVED'].includes(event.status)); },
    async getUserDisplayName(id) { return accounts.get(id)?.email || null; },
  };
};
