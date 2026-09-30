// Constructed only when the server-side data key is configured.
module.exports = function createEquipmentDependencies() {
  const client = require("../../supabase");
  const { createEquipmentService } = require("./equipment.service");
  const { createMessagesService } = require("./messages.service");
  const fields = "id, name, coordinator_id, start_time, end_time, status";
  async function unwrap(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  return {
    equipmentService: createEquipmentService(client),
    messagesService: createMessagesService(client),
    findEventById: (id) => unwrap(client.from("events").select(fields).eq("id", id).maybeSingle()),
    findEventsByIds: (ids) => ids.length ? unwrap(client.from("events").select("id, name").in("id", ids)) : Promise.resolve([]),
    listAssignedEvents: (id) => unwrap(client.from("events").select(fields).eq("coordinator_id", id).in("status", ["ACCEPTED", "APPROVED"]).order("start_time", { ascending: true })),
    async getUserDisplayName(id) {
      const { data, error } = await client.auth.admin.getUserById(id);
      if (error || !data?.user) return null;
      return data.user.user_metadata?.full_name || data.user.email || null;
    },
  };
};
