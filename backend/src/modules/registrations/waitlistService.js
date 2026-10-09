function createWaitlistService(client) {
  async function join(eventId, attendeeId) {
    const { data, error } = await client.rpc("enqueue_waitlist_if_full", {
      p_event_id: eventId,
      p_attendee_id: attendeeId,
    });
    if (error) return { ok: false, reason: "storage_error", error };
    if (data?.outcome !== "joined") {
      return { ok: false, reason: data?.outcome ?? "invalid_request" };
    }

    const position = await getPosition(eventId, attendeeId);
    if (!position.ok) return position;
    return {
      ok: true,
      entry: data.entry,
      position: position.position,
    };
  }

  async function activeEntries(eventId) {
    const { data, error } = await client
      .from("event_waitlist_entries")
      .select("id, event_id, status, created_at")
      .eq("event_id", eventId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return { ok: false, reason: "storage_error", error };
    return { ok: true, entries: data ?? [] };
  }

  async function getPosition(eventId, attendeeId) {
    const { data: entry, error } = await client
      .from("event_waitlist_entries")
      .select("id, event_id, status, created_at")
      .eq("event_id", eventId)
      .eq("attendee_id", attendeeId)
      .eq("status", "active")
      .maybeSingle();
    if (error) return { ok: false, reason: "storage_error", error };
    if (!entry) return { ok: false, reason: "not_found" };

    const result = await activeEntries(eventId);
    if (!result.ok) return result;
    const index = result.entries.findIndex((candidate) => candidate.id === entry.id);
    if (index < 0) return { ok: false, reason: "not_found" };
    return { ok: true, entry, position: index + 1 };
  }

  async function withdraw(eventId, attendeeId) {
    const { data, error } = await client
      .from("event_waitlist_entries")
      .delete()
      .eq("event_id", eventId)
      .eq("attendee_id", attendeeId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, reason: "storage_error", error };
    if (!data) return { ok: false, reason: "not_found" };
    return { ok: true };
  }

  return { join, getPosition, withdraw };
}

module.exports = createWaitlistService;
