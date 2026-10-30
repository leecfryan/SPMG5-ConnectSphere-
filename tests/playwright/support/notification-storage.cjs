const { randomUUID } = require('node:crypto');
const { createNotificationsService } = require('../../../backend/src/modules/notifications/notifications.service');
const { createNotificationDeliveryService } = require('../../../backend/src/modules/notifications/notificationDelivery.service');

module.exports = function notificationStorage({ auth, eventsRepository, dataClient, venuesService }) {
  const pending = new Map(), inbox = new Map();
  const venueWork = require('./venue-hold-notification-storage.cjs')(venuesService, dataClient, pending, auth);
  const prepareAssignments = require('./assignment-notification-storage.cjs')(dataClient, pending);
  const registrationWork = require('./registration-notification-storage.cjs')(dataClient, pending, auth);
  require('./request-baseline-storage.cjs')(dataClient, eventsRepository);
  require('./resubmission-storage.cjs')(dataClient, pending);
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
  const returnRequest = eventsRepository.requestChanges.bind(eventsRepository);
  eventsRepository.requestChanges = async (...args) => {
    const event = await returnRequest(...args);
    if (event) {
      const history = dataClient.activity.filter(row => row.event_id === event.id && row.action === 'CHANGES_REQUESTED').at(-1);
      pending.set(history.id, { id: history.id, lease_token: randomUUID(), recipient_id: history.details.organiser_id,
        workflow: 'event-changes-requested', payload: { eventId: event.id, cycleId: history.id,
          eventName: history.details.before.name, message: history.details.note, requestPath: '/my-event-requests/' + event.id } });
    }
    return event;
  };
  // SCRUM-143: control endpoints are inside the existing private test-only router.
  auth.post('/__test/notification-deliveries/:id', async (req, res) => {
    const worker = createNotificationDeliveryService({
      repository: {
        prepareAssignments, ...registrationWork, ...venueWork,
        claim: async () => [...pending.values()].filter(row => row.recipient_id === req.params.id),
        complete: async row => pending.delete(row.id), retry: async () => {},
      },
      secretKey: 'local-novu-fixture-only',
      fetchImpl: async (_url, args) => {
        const { name, transactionId, to, payload } = JSON.parse(args.body);
        const venueHold = name === 'venue-hold-expiry';
        const registration = ['registration-status', 'waitlist-offer-expiring'].includes(name);
        const assignment = name === 'event-assignment';
        const resubmitted = name === 'event-request-resubmitted';
        const clarification = name === 'event-changes-requested';
        const action = { assigned: 'assigned to you', reassigned: 'reassigned to you', 'reassigned-away': 'reassigned from you' }[payload.assignmentType];
        inbox.set(transactionId, {
          id: transactionId, transactionId, to, subject: venueHold ? 'Venue hold update: ' + payload.venueName : registration ? 'Registration update: ' + payload.eventName : resubmitted ? 'Request resubmitted' : clarification ? 'Changes requested: ' + payload.eventName : assignment ? 'Event assignment' : 'Event ' + payload.outcome,
          redirect: (venueHold || registration || clarification || resubmitted) ? { url: payload.requestPath, target: '_self' } : undefined,
          body: (venueHold || registration) ? payload.message : resubmitted ? 'The organiser has resubmitted ' + payload.eventName + '. Open the request to review the updated details.' : clarification ? payload.message : assignment ? 'Event “' + payload.eventName + '” was ' + action + ' by ' + payload.assignedByName + '.' : 'Your event “' + payload.eventName + '” was ' + payload.outcome + '. Note: ' + payload.remark,
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
