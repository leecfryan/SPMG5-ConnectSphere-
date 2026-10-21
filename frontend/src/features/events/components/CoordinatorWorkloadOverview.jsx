import { useState } from "react";
import { Link } from "react-router";
import { useApiResource } from "../../../hooks/useApiResource";
import { ACTIVE_STATUSES, STATUS_LABELS } from "../statuses";
import StatusBadge from "./StatusBadge";

// SCRUM-161: the Event Coordinator Lead's workload overview on /event-management.
// The server already scopes this list to the Lead (events.review); the filters
// only narrow it. AC3's coordinator scope is enforced by the coordinator
// endpoint, never by anything here.
//
// Deliberately absent: reassigning from this list (the event detail page owns
// it, SCRUM-26) and workload counts or balancing rules (no AC asks for them).

const DEFAULT_FILTERS = Object.freeze({ coordinator: "all", status: "active" });

// "active" opens the overview on events still in progress (AC1); "all" keeps
// the workspace's existing view, where rejected and cancelled events stay
// visible to the Lead (SCRUM-148 AC4).
function matchesStatus(status, filter) {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE_STATUSES.includes(status);
  return status === filter;
}

function matchesCoordinator(coordinatorId, filter) {
  if (filter === "all") return true;
  if (filter === "unassigned") return coordinatorId === null;
  return coordinatorId === filter;
}

// Lifecycle order first, then any status the labels don't know, so a new
// backend state stays selectable instead of vanishing.
function statusOptions(events) {
  const present = new Set(events.map(event => event.status));
  const known = Object.keys(STATUS_LABELS).filter(status => present.has(status));
  return [...known, ...[...present].filter(status => !Object.hasOwn(STATUS_LABELS, status))];
}

// Never invent an outcome: without the directory the row keeps the plain
// wording, and only a loaded directory can say a coordinator has left the role.
function coordinatorLabel(coordinatorId, names) {
  if (!coordinatorId) return "Awaiting coordinator";
  if (!names) return "Coordinator assigned";
  return names.get(coordinatorId) ?? "No longer active";
}

export default function CoordinatorWorkloadOverview({ events, path }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const directory = useApiResource("/api/event-workspace/coordinators");
  const coordinators = directory.data?.coordinators ?? [];
  const names = directory.data ? new Map(coordinators.map(coordinator => [coordinator.id, coordinator.name])) : null;
  const visible = events.filter(event =>
    matchesCoordinator(event.coordinator_id, filters.coordinator) && matchesStatus(event.status, filters.status));
  const filtersApplied = filters.coordinator !== DEFAULT_FILTERS.coordinator || filters.status !== DEFAULT_FILTERS.status;
  const choose = key => change => setFilters(current => ({ ...current, [key]: change.target.value }));

  return <>
    <section className="event-overview-filters" aria-labelledby="assignment-overview-filters">
      <h2 id="assignment-overview-filters">Filter assignments</h2>
      <div className="event-overview-field">
        <label htmlFor="assignment-coordinator-filter">Coordinator</label>
        <select id="assignment-coordinator-filter" value={filters.coordinator} onChange={choose("coordinator")}>
          <option value="all">All coordinators</option>
          <option value="unassigned">Awaiting coordinator</option>
          {coordinators.map(coordinator => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}
        </select>
      </div>
      <div className="event-overview-field">
        <label htmlFor="assignment-status-filter">Event status</label>
        <select id="assignment-status-filter" value={filters.status} onChange={choose("status")}>
          <option value="active">All active statuses</option>
          <option value="all">All statuses</option>
          {statusOptions(events).map(status => <option key={status} value={status}>{STATUS_LABELS[status] ?? status}</option>)}
        </select>
      </div>
      {filtersApplied && <button type="button" className="secondary event-overview-clear" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>}
      {directory.error && <p className="error" role="alert">{directory.error}</p>}
    </section>
    {events.length > 0 && visible.length === 0 && <p className="event-overview-empty">{filtersApplied
      ? "No events match these filters. Clear the filters to see every active event."
      : "No active events right now. Choose All statuses to see closed events."}</p>}
    {visible.length > 0 && <div className="event-overview-scroll">
      <table className="event-overview-table">
        <caption>{visible.length} of {events.length} events shown</caption>
        <thead><tr><th scope="col">Event</th><th scope="col">Status</th><th scope="col">Coordinator</th></tr></thead>
        <tbody>
          {visible.map(event => {
            const label = coordinatorLabel(event.coordinator_id, names);
            const needsAttention = label === "Awaiting coordinator" || label === "No longer active";
            return <tr key={event.id}>
              <th scope="row"><Link to={`${path}/${event.id}`}>{event.name}</Link></th>
              <td><StatusBadge status={event.status} /></td>
              <td>{needsAttention ? <span className="event-overview-attention">{label}</span> : label}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
  </>;
}
