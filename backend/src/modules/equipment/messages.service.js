// Data access for clarification thread messages (Scrum-28-Scrum65/66).
// Factory, same reasoning as equipment.service.js: messages.routes wiring
// binds it to the real client, messages.functional.test.js binds it to an
// in-memory fake.
const TABLE = "messages";

function unwrap({ data, error }, action) {
  if (error) {
    throw new Error(`messages.service: ${action} failed - ${error.message}`);
  }
  return data;
}

function createMessagesService(client) {
  // Every message links to one equipment_request_id (the real schema makes
  // this NOT NULL) - a whole event's thread is every message across that
  // event's equipment_request rows, so callers pass the full set of ids.
  // Soft-deleted rows (deleted_at) are excluded - no delete endpoint exists
  // yet, but the column and its partial index already do, so reads respect
  // it now rather than needing a second change later.
  async function listByEquipmentRequestIds(equipmentRequestIds) {
    if (equipmentRequestIds.length === 0) return [];
    return unwrap(
      await client
        .from(TABLE)
        .select("*")
        .in("equipment_request_id", equipmentRequestIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      "listByEquipmentRequestIds",
    );
  }

  async function findById(id) {
    return unwrap(
      await client.from(TABLE).select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
      "findById",
    );
  }

  // authorId/authorRole are passed as their own arguments, never taken from
  // `fields` - same pattern as requestedBy in equipment.service.js.
  async function create(fields, authorId, authorRole) {
    const row = {
      equipment_request_id: fields.equipment_request_id,
      body: fields.body,
      author_id: authorId,
      author_role: authorRole,
    };
    return unwrap(
      await client.from(TABLE).insert(row).select().single(),
      "create",
    );
  }

  // updated_at has no default in the real schema (stays null until the
  // first edit) - the messages_set_updated_at trigger sets it on UPDATE,
  // never on INSERT, so this file never sets it itself.
  async function updateBody(id, body) {
    return unwrap(
      await client.from(TABLE).update({ body }).eq("id", id).select().maybeSingle(),
      "updateBody",
    );
  }

  return { listByEquipmentRequestIds, findById, create, updateBody };
}

module.exports = { createMessagesService };
