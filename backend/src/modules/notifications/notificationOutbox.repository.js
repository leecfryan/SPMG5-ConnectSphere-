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
    claim: () => rpc("claim_notification_outbox", {}),
    complete: row => finish(row, true),
    retry: row => finish(row, false),
  };
}
module.exports = { createNotificationOutboxRepository };
