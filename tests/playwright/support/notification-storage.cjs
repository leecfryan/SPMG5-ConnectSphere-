const { randomUUID } = require('node:crypto');
const { createNotificationsService } = require('../../../backend/src/modules/notifications/notifications.service');
const { createNotificationDeliveryService } = require('../../../backend/src/modules/notifications/notificationDelivery.service');

module.exports = function notificationStorage({ auth, eventsRepository, dataClient }) {
  const pending = new Map(), inbox = new Map();
  const prepareAssignments = require('./assignment-notification-storage.cjs')(dataClient, pending);
  const transition = eventsRepository.transitionStatus.bind(eventsRepository);
  eventsRepository.transitionStatus = async (...args) => {
    const event = await transition(...args);
    if (event && args[1] === 'UNDER_REVIEW' && ['APPROVED', 'REJECTED'].includes(event.status)) {
      const id = randomUUID();
      pending.set(id, { id, lease_token: randomUUID(), recipient_id: event.organiser_id,
        payload: { eventId: event.id, eventName: event.name, outcome: event.status.toLowerCase(), remark: event.approval_rejection_remark || '' } });
    }
    return event;
  };
  // SCRUM-143: control endpoints are inside the existing private test-only router.
  auth.post('/__test/notification-deliveries/:id', async (req, res) => {
    const worker = createNotificationDeliveryService({
      repository: {
        prepareAssignments,
        claim: async () => [...pending.values()].filter(row => row.recipient_id === req.params.id),
        complete: async row => pending.delete(row.id), retry: async () => {},
      },
      secretKey: 'local-novu-fixture-only',
      fetchImpl: async (_url, args) => {
        const { name, transactionId, to, payload } = JSON.parse(args.body);
        const assignment = name === 'event-assignment';
        const action = { assigned: 'assigned to you', reassigned: 'reassigned to you', 'reassigned-away': 'reassigned from you' }[payload.assignmentType];
        inbox.set(transactionId, {
          id: transactionId, transactionId, to, subject: assignment ? 'Event assignment' : 'Event ' + payload.outcome,
          body: assignment ? 'Event “' + payload.eventName + '” was ' + action + ' by ' + payload.assignedByName + '.' : 'Your event “' + payload.eventName + '” was ' + payload.outcome + '. Note: ' + payload.remark,
          isRead: false, isSeen: false, isArchived: false, isSnoozed: false,
          channelType: 'in_app', severity: 'none', createdAt: new Date().toISOString(), tags: [], data: payload,
        });
        return { ok: true, json: async () => ({ data: { acknowledged: true, status: 'processed', transactionId } }) };
      },
    });
    await worker.runOnce();
    res.json({ notifications: [...inbox.values()].filter(item => item.to.subscriberId === req.params.id), pending: [...pending.values()].filter(row => row.recipient_id === req.params.id).length });
  });
  return { identity: createNotificationsService({ applicationIdentifier: 'fixture-app', secretKey: 'local-novu-fixture-only' }) };
};
