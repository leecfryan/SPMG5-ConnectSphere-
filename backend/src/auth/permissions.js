// Initial staff matrix agreed for the "Restrict internal staff access by responsibility" story.
// Read access only. Mutation permissions belong to their feature stories.
const policies = Object.freeze({
  "internal.access": {
    roles: ["event_coordinator", "venue_staff", "technical_support_staff"],
  },
  "venues.read": {
    roles: ["venue_staff", "event_coordinator"],
    label: "Venue information and availability",
  },
  "bookings.read": {
    roles: ["venue_staff", "event_coordinator"],
    label: "Venue booking information",
    record: true,
  },
  "equipment.read": {
    roles: ["technical_support_staff", "event_coordinator"],
    label: "Equipment information and availability",
  },
  "technical_requests.read": {
    roles: ["technical_support_staff", "event_coordinator"],
    label: "Technical requirements and arrangements",
    record: true,
  },
  "event_planning.read": {
    roles: ["event_coordinator"],
    label: "Internal event planning",
    record: true,
  },
  "attendees.read": {
    roles: ["event_coordinator"],
    label: "Event registration information",
    record: true,
  },
  "clients.read": {
    roles: ["event_coordinator"],
    label: "Client information for managed events",
    record: true,
  },
  "event_organisers.read": {
    roles: ["event_coordinator", "event_ops_manager"],
    label: "Event organiser information for managed events",
    record: true,
  },
  // First mutation permissions in this file (see header note above) - added
  // for the equipment request story. Coordinators request equipment;
  // technical support staff edit those requests. Neither role does both:
  // a Coordinator cannot edit after submitting, and Technical Support Staff
  // does not submit new requests on a Coordinator's behalf.
  "equipment_requests.create": {
    roles: ["event_coordinator"],
    label: "Equipment request submission",
    // Coordinators may only request equipment for an event they organise
    // or coordinate - see events.coordinator_id/organiser_id, enforced via
    // an authorizeRecord resolver (equipment.controller.js#authorizeEventOwnership).
    record: true,
  },
  "equipment_requests.update": {
    roles: ["technical_support_staff"],
    label: "Equipment request management",
    // Deliberately unrestricted by event, matching the "Tech support can
    // manage equipment requests" RLS policy in the same migration.
  },
});

function getPolicy(permission) {
  return Object.hasOwn(policies, permission) ? policies[permission] : undefined;
}

function hasPermission(roles, permission) {
  const policy = getPolicy(permission);
  return Boolean(
    policy &&
    Array.isArray(roles) &&
    roles.some((role) => policy.roles.includes(role)),
  );
}

function getResponsibilities(roles) {
  return Object.entries(policies)
    .filter(
      ([permission, policy]) =>
        policy.label && hasPermission(roles, permission),
    )
    .map(([permission, policy]) => ({
      permission,
      label: policy.label,
      requiresRecordCheck: Boolean(policy.record),
    }));
}

module.exports = { getPolicy, hasPermission, getResponsibilities };
