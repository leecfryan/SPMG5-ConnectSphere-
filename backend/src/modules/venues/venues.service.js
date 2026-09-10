const supabase = require("../../supabase");

// SCRUM-82, 83, 84: everything a Coordinator needs to assess a venue
const VENUE_FIELDS = [
  "id", "name", "address", "city", "country", "capacity",
  "facilities", "accessibility_features", "room_layouts",
  "operating_hours", "setup_minutes", "teardown_minutes",
  "turnaround_minutes", "notes", "is_active",
].join(", ");

async function listVenues({ city, minCapacity } = {}) {
  let query = supabase
    .from("venues")
    .select(VENUE_FIELDS)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (city) query = query.ilike("city", city);
  if (Number.isFinite(minCapacity)) query = query.gte("capacity", minCapacity);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list venues: ${error.message}`);
  return data;
}

async function getVenueById(id) {
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch venue: ${error.message}`);
  return data;
}

async function updateVenue(id, changes) {
  const { data, error } = await supabase
    .from("venues")
    .update(changes)
    .eq("id", id)
    .select(VENUE_FIELDS)
    .maybeSingle();

  if (error) throw new Error(`Failed to update venue: ${error.message}`);
  return data;
}

module.exports = { listVenues, getVenueById, updateVenue };