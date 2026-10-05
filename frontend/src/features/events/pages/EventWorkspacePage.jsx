import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import { workspaces } from "../workspaces";
import StatusBadge from "../components/StatusBadge";
import "../workspace.css";

function EventList({ events, workspace, userId }) {
  return <ul className="event-workspace-list">
    {events.map(event => <li key={event.id}>
      <Link to={`${workspace.path}/${event.id}`}>{event.name}</Link>
      <span><StatusBadge status={event.status} /> · {event.coordinator_id ? "Coordinator assigned" : "Awaiting coordinator"}
        {userId && (event.organiser_id === userId ? " · You are responsible" : " · View only")}</span>
    </li>)}
  </ul>;
}

export default function EventWorkspacePage({ scope }) {
  const workspace = workspaces[scope];
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const { data, loading, error, reload } = useApiResource(`/api/event-workspace/${scope}`);
  const events = (data?.events || []).filter(event => event.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const ownEvents = events.filter(event => event.organiser_id === user.id);
  const otherEvents = events.filter(event => event.organiser_id !== user.id);
  return <section className="card event-workspace">
    <h1>{workspace.title}</h1>
    <p>{workspace.description}</p>
    <button type="button" onClick={reload}>Refresh events</button>
    {loading && <p role="status">Loading events…</p>}
    {error && <p role="alert">{error}</p>}
    {scope === "organiser" && <>
      <label htmlFor="organiser-event-search">Search events</label>
      <input id="organiser-event-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
    </>}
    {data?.events.length === 0 && <p>No events to show yet.</p>}
    {data?.events.length > 0 && events.length === 0 && <p>No events match your search.</p>}
    {scope === "organiser" && data && <>
      <section aria-labelledby="own-events-title">
        <h2 id="own-events-title">Events you are responsible for</h2>
        <EventList events={ownEvents} workspace={workspace} userId={user.id} />
      </section>
      <section aria-labelledby="organisation-events-title">
        <h2 id="organisation-events-title">Other organisers’ event requests</h2>
        <p>View-only requests from other organisers in your company.</p>
        <EventList events={otherEvents} workspace={workspace} userId={user.id} />
      </section>
    </>}
    {scope !== "organiser" && <EventList events={events} workspace={workspace} />}
    {scope === "organiser" && <Link to="/events/new">Submit an event request</Link>}
  </section>;
}
