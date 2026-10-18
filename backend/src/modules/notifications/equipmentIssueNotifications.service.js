function createEquipmentIssueNotificationsService({ client, logger = console }) {
  async function notifyIssue(previous, saved, actorId) {
    if (!saved || saved.status !== "REJECTED" || previous.status === "REJECTED") return;
    try {
      const { error } = await client.rpc("enqueue_equipment_issue_notifications", {
        p_request_id: saved.id,
        p_actor_id: actorId,
      }).abortSignal(AbortSignal.timeout(10000));
      if (error) throw new Error("Equipment issue notification queue is unavailable.");
    } catch {
      // SCRUM-155: notification failure must not fail the saved equipment operation.
      logger.warn("Equipment issue was saved, but its notification could not be queued.");
    }
  }
  return { notifyIssue };
}
module.exports = { createEquipmentIssueNotificationsService };
