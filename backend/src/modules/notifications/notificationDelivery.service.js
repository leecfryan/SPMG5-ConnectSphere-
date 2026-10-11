function createNotificationDeliveryService({ repository, secretKey, fetchImpl = fetch, logger = console }) {
  if (!repository || !secretKey?.trim()) return undefined;
  let running = false;
  let timer;
  const warn = () => logger.warn("Notification delivery is pending. Check the queue and Novu workflow configuration.");

  async function deliver(row) {
    const response = await fetchImpl("https://api.novu.co/v1/events/trigger", {
      method: "POST",
      headers: { Authorization: "ApiKey " + secretKey, "Content-Type": "application/json", "Idempotency-Key": row.id },
      body: JSON.stringify({ name: "event-decision", to: { subscriberId: row.recipient_id }, transactionId: row.id, payload: row.payload }),
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
    if (!response.ok) throw new Error("Notification provider did not accept the request.");
    const body = await response.json();
    const result = body.data ?? body;
    if (result.acknowledged !== true || result.status !== "processed" || result.transactionId !== row.id) {
      throw new Error("Notification workflow did not accept the request.");
    }
    await repository.complete(row);
  }

  async function runOnce() {
    if (running) return;
    running = true;
    try {
      const rows = await repository.claim();
      for (const row of rows) {
        try { await deliver(row); }
        catch {
          warn();
          // SCRUM-143: a failed acknowledgement keeps the same durable ID for safe replay.
          await repository.retry(row);
        }
      }
    } catch { warn(); }
    finally { running = false; }
  }

  function stop() { clearInterval(timer); timer = undefined; }
  function start() {
    if (!timer) {
      void runOnce();
      timer = setInterval(() => { void runOnce(); }, 15000);
      timer.unref();
    }
    return stop;
  }
  return { runOnce, start, stop };
}
module.exports = { createNotificationDeliveryService };
