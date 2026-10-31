import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import Icon from "../../../components/ui/Icon";
import { workspaces } from "../workspaces";
import StatusBadge from "../components/StatusBadge";
import DraftList from "../components/DraftList";
import CoordinatorWorkloadOverview from "../components/CoordinatorWorkloadOverview";
import "../workspace.css";

function EventList({ events, workspace, userId }) {
  return <ul className="event-workspace-list event-request-list">
    {events.map(event => <li key={event.id}>
      <Link
        className="event-request-link"
        to={`${workspace.path}/${event.id}`}
        aria-labelledby={`event-request-title-${event.id}`}
        aria-describedby={`event-request-meta-${event.id}`}
      >
        <span className="event-request-icon"><Icon name="request" size={22} /></span>
        <div className="event-request-content">
          <h3 className="event-request-title" id={`event-request-title-${event.id}`}>{event.name}</h3>
          <div className="event-request-meta" id={`event-request-meta-${event.id}`}>
            <StatusBadge status={event.status} />
            {event.pending_change_request && <span className="status-badge status-change-pending">Change pending</span>}
            <span><Icon name="account" size={15} />{event.coordinator_id ? "Coordinator assigned" : "Awaiting coordinator"}</span>
            {userId && <span className="event-request-ownership"><Icon name={event.organiser_id === userId ? "check" : "shield"} size={15} />{event.organiser_id === userId ? "You are responsible" : "View only"}</span>}
          </div>
        </div>
        <span className="event-request-open" aria-hidden="true">View request <Icon name="arrow" size={18} /></span>
      </Link>
    </li>)}
  </ul>;
}

export default function EventWorkspacePage({ scope }) {
  const workspace = workspaces[scope];
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useApiResource(`/api/event-workspace/${scope}`, refreshKey);
  const events = (data?.events || []).filter(event => event.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const ownEvents = events.filter(event => event.organiser_id === user.id);
  const otherEvents = events.filter(event => event.organiser_id !== user.id);
  return <section className="card event-workspace">
    <h1>{workspace.title}</h1>
    <p>{workspace.description}</p>
    <button type="button" onClick={() => setRefreshKey(key => key + 1)}>Refresh events</button>
    {loading && <p role="status">Loading events…</p>}
    {error && <p role="alert">{error}</p>}
    {scope === "organiser" && <>
      <label htmlFor="organiser-event-search">Search events</label>
      <input id="organiser-event-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
    </>}
    {data?.events.length === 0 && <p>No events to show yet.</p>}
    {data?.events.length > 0 && events.length === 0 && <p>No events match your search.</p>}
    {scope === "organiser" && <DraftList />}
    {scope === "organiser" && data && <>
      <section className="event-request-group" aria-labelledby="own-events-title">
        <h2 id="own-events-title">Events you are responsible for <span className="event-request-count" aria-hidden="true">{ownEvents.length}</span></h2>
        <EventList events={ownEvents} workspace={workspace} userId={user.id} />
      </section>
      <section className="event-request-group" aria-labelledby="organisation-events-title">
        <h2 id="organisation-events-title">Other organisers’ event requests <span className="event-request-count" aria-hidden="true">{otherEvents.length}</span></h2>
        <p>View-only requests from other organisers in your company.</p>
        <EventList events={otherEvents} workspace={workspace} userId={user.id} />
      </section>
    </>}
    {/* Mounted while loading too, so Refresh events keeps the Lead's filters. */}
    {scope === "manager" && <CoordinatorWorkloadOverview events={data?.events ?? []} path={workspace.path} refreshKey={refreshKey} />}
    {scope === "coordinator" && <EventList events={events} workspace={workspace} />}
    {scope === "organiser" && <Link to="/events/new">Submit an event request</Link>}
  </section>;
}
