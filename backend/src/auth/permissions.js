// Initial staff matrix agreed for the "Restrict internal staff access by responsibility" story.
// Feature writes have separate permissions; read grants never authorise mutations.
const policies = Object.freeze({
  // External organisers submit their own requests; this grants no internal access.
  "events.submit": {
    roles: ["event_organiser"],
  },
  "venues.update": {
    roles: ["venue_staff", "event_coordinator"],
  },
  "bookings.request": {
    roles: ["event_coordinator"],
  },
  "equipment.request": { roles: ["event_coordinator"] },
  "equipment.review": { roles: ["technical_support_staff"] },
  "equipment.messages": {
    roles: ["technical_support_staff", "event_coordinator"],
  },
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

// Capabilities only: record checks and the /api/internal gate still apply independently.
function getPermissions(roles) {
  return Object.keys(policies).filter((permission) =>
    hasPermission(roles, permission),
  );
}

module.exports = {
  getPolicy,
  hasPermission,
  getResponsibilities,
  getPermissions,
};
