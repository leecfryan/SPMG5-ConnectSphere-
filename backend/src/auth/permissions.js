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
