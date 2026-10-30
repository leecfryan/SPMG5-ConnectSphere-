function createNotificationOutboxRepository(client) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(10000));
    if (error) throw new Error("Notification queue is unavailable.");
    return data;
  }
  const finish = (row, succeeded) => rpc("finish_notification_outbox", {
    delivery_id: row.id, claim_token: row.lease_token, succeeded,
  });
  return {
    prepareAssignments: () => rpc("enqueue_assignment_notifications", {}),
    prepareRegistrations: () => rpc("enqueue_registration_notifications", {}),
    prepareReminders: () => rpc("enqueue_waitlist_offer_reminders", {}),
    reminderIsCurrent: async row => {
      const current = await rpc("validate_waitlist_offer_reminder", {
        delivery_id: row.id, claim_token: row.lease_token,
      });
      if (typeof current !== "boolean") throw new Error("Notification queue is unavailable.");
      return current;
    },
    prepareVenueHolds: () => rpc("enqueue_venue_hold_notifications", {}),
    venueHoldNotificationIsCurrent: async row => {
      const valid = await rpc("validate_venue_hold_notification", { delivery_id: row.id, claim_token: row.lease_token });
      if (typeof valid !== "boolean") throw new Error("Notification queue is unavailable.");
      return valid;
    },
    claim: () => rpc("claim_notification_outbox", {}),
    complete: row => finish(row, true),
    retry: row => finish(row, false),
  };
}
module.exports = { createNotificationOutboxRepository };
