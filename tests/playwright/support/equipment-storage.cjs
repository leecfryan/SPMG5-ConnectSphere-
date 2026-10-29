// Only used by local Playwright servers, never by production startup.
const { randomUUID } = require('node:crypto');
const {
  BLOCKING_REQUEST_STATUSES, isBlockingOverlap, findAvailableUnits, groupRequestsByEquipmentId, planReservation,
} = require('../../../backend/src/modules/equipment/equipment.validation');
module.exports = function equipmentStorage(accounts) {
  const requests = [];
  const messages = [];
  const events = () => [...accounts.values()].flatMap(account => account.events);
  const equipment = () => [...accounts.values()].map(account => ({ id: account.id, type: 'Projector ' + account.id, current_location: 'Singapore', status: 'AVAILABLE' }));
  const equipmentService = {
    async listEquipment() { return equipment(); },
    async findEquipmentById(id) { return equipment().find(item => item.id === id) || null; },
    async listRequestsByEvent(id) { return requests.filter(row => row.event_id === id); },
    async findRequestById(id) { return requests.find(row => row.id === id) || null; },
    async listAllRequests() { return requests; },
    async hasOverlappingRequest(id, start, end) { return requests.some(row => row.equipment_id === id && BLOCKING_REQUEST_STATUSES.includes(row.status) && isBlockingOverlap(row, start, end)); },
    async listEquipmentByType(type) { return equipment().filter(item => item.type === type); },
    async listActiveRequestsForEquipment(ids) { return requests.filter(row => ids.includes(row.equipment_id) && BLOCKING_REQUEST_STATUSES.includes(row.status)); },
    // SCRUM-103 (added scope): the catalogue's "in use today" overlay.
    // Pre-existing gap, same story as listReleasableEventIds above - never
    // provided here, never hit before.
    async listApprovedRequestsForEquipmentIds(ids) { return requests.filter(row => ids.includes(row.equipment_id) && row.status === 'APPROVED'); },
    // SCRUM-31: one submission becomes `quantity_requested` sibling rows
    // sharing a group_id, no equipment_id yet - mirrors the real
    // equipment.service.js's createRequestGroup exactly, see that file.
    async createRequestGroup(fields, requestedBy) {
      const groupId = randomUUID();
      const base = {
        event_id: fields.event_id, equipment_type: fields.equipment_type, quantity_requested: 1,
        is_essential: fields.is_essential, borrow_start: fields.borrow_start, borrow_end: fields.borrow_end,
        requested_by: requestedBy, status: 'PENDING', group_id: groupId, created_at: new Date().toISOString(),
      };
      if (fields.technical_requirement !== undefined) base.technical_requirement = fields.technical_requirement;
      const rows = Array.from({ length: fields.quantity_requested }, () => ({ ...base, id: randomUUID() }));
      requests.push(...rows);
      return rows;
    },
    async listRequestsByGroupId(groupId) { return requests.filter(row => row.group_id === groupId); },
    async assignUnitToRequest(id, equipmentId) {
      const row = requests.find(row => row.id === id);
      if (!row) return null;
      row.equipment_id = equipmentId;
      row.status = 'APPROVED';
      return row;
    },
    // SCRUM-31: mirrors the real reserveGroup - same pure findAvailableUnits/
    // planReservation this fake already shares with production, so the
    // decision logic can never drift between the real service and this fake.
    async reserveGroup(groupId) {
      const siblings = requests.filter(row => row.group_id === groupId);
      if (siblings.length === 0) return null;
      const pendingRequests = siblings.filter(row => row.status === 'PENDING');
      if (pendingRequests.length === 0) return { ok: true, reserved: [], unfulfilled: [] };

      const { equipment_type: type, borrow_start: requestedStart, borrow_end: requestedEnd } = siblings[0];
      const isEssential = siblings.some(row => row.is_essential === true);
      const equipmentUnits = equipment().filter(unit => unit.type === type);
      const activeRequests = requests.filter(row => equipmentUnits.some(unit => unit.id === row.equipment_id) && BLOCKING_REQUEST_STATUSES.includes(row.status));
      const availableUnits = findAvailableUnits({
        equipmentUnits, requestsByEquipmentId: groupRequestsByEquipmentId(activeRequests), requestedStart, requestedEnd,
      });

      const plan = planReservation({ pendingRequests, availableUnits, isEssential });
      if (!plan.ok) return { ok: false, reason: plan.reason, availableCount: plan.availableCount, pendingCount: plan.pendingCount };

      const reserved = [];
      for (const { requestId, equipmentId } of plan.assignments) {
        const row = requests.find(row => row.id === requestId);
        row.equipment_id = equipmentId;
        row.status = 'APPROVED';
        reserved.push(row);
      }
      const unfulfilled = [];
      for (const requestId of plan.unfulfilledRequestIds) {
        const row = requests.find(row => row.id === requestId);
        row.status = 'UNFULFILLED';
        unfulfilled.push(row);
      }
      return { ok: true, reserved, unfulfilled };
    },
    // SCRUM-148: the fixture units are AVAILABLE; cancellation releases only their event reservations.
    // SCRUM-150: renamed from releaseReservationsForCancelledEvent to match the real
    // equipment.service.js - review.service.js now calls this same name from both
    // cancel() and postpone(), and REVIEW_REQUIRED joins the releasable set there too.
    async releaseReservationsForEvent(eventId) {
      const releasable = requests.filter(row => row.event_id === eventId && ['PENDING', 'APPROVED', 'REVIEW_REQUIRED'].includes(row.status));
      for (const row of releasable) row.status = 'RELEASED';
      return { released: releasable.map(row => row.id), equipmentReverted: [], equipmentSkipped: [] };
    },
    // SCRUM-150: flagReservationsForReview used to live here, called by
    // eventWorkspace.service.js through `?.` - SCRUM-37 moved that whole call
    // into apply_organiser_event_edit (SQL, real Postgres only), so
    // eventWorkspace.routes.js no longer threads equipmentService through at
    // all. Removed rather than left unreachable (it was already unreachable
    // by every Playwright spec before this, per its own prior comment).
    // SCRUM-150: equipment.controller.js calls this directly, not through `?.` -
    // a missing method here would throw, not silently no-op, the moment any
    // REVIEW_REQUIRED row is read or approved.
    async isRequestAvailableForWindow(request) {
      const unit = equipment().find(item => item.id === request.equipment_id);
      if (!unit || unit.status !== 'AVAILABLE') return false;
      const others = requests.filter(row => row.equipment_id === request.equipment_id && row.id !== request.id && BLOCKING_REQUEST_STATUSES.includes(row.status));
      return !others.some(row => isBlockingOverlap(row, request.borrow_start, request.borrow_end));
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
    // SCRUM-104: every equipment read sweeps CANCELLED/REJECTED events for
    // still-active requests to self-heal (see equipment.controller.js's
    // releaseReservationsForTerminalEvents) - this fixture's events never
    // reach those statuses, so there is nothing to sweep. Pre-existing gap:
    // this was always required by createApp but never provided here, just
    // never hit before because no Playwright spec read the equipment
    // catalogue through the browser until SCRUM-31's.
    async listReleasableEventIds() { return []; },
    async listAssignedEvents(id) { return events().filter(event => event.coordinator_id === id && ['APPROVED', 'CONFIRMED'].includes(event.status)); },
    async getUserDisplayName(id) { return accounts.get(id)?.email || null; },
  };
};
