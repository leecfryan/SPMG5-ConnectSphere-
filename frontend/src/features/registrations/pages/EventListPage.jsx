import { useState } from "react";
import { Link } from "react-router";
import Icon from "../../../components/ui/Icon";
import { useRegistrationResource } from "../hooks/useRegistrationResource";
import { getRegistrationAvailability, registrationAvailabilityLabel } from "../registrationAvailability";
import { useRegistrationWindow } from "../useRegistrationWindow";
import RegistrationWindowNotice from "../components/RegistrationWindowNotice";

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function EventListPage() {
  const { data, error, reload } = useRegistrationResource("/api/events");
  const { data: windowData, receivedAt, refresh } = useRegistrationResource("/api/events/registration-windows");
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [sort, setSort] = useState("soonest");
  const events = data?.events;
  const windows = new Map((windowData?.windows ?? []).map((window) => [window.id, window]));
  const locations = [...new Set((events ?? []).flatMap(event =>
    (event.venue_booking_requests ?? []).map(booking => booking.venue?.city).filter(Boolean)
  ))].sort((a, b) => a.localeCompare(b));
  const visibleEvents = (events ?? []).filter(event => {
    const availability = getRegistrationAvailability(event);
    const matchesSearch = `${event.name} ${event.description ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesLocation = !location || event.venue_booking_requests?.some(booking => booking.venue?.city === location);
    const start = event.start_time ? new Date(event.start_time) : null;
    const matchesDate = !date || (start && start >= new Date(`${date}T00:00:00`));
    const matchesAvailability = availabilityFilter === "all" || (availability.known && (availabilityFilter === "available" ? !availability.isFull : availability.isFull));
    return matchesSearch && matchesLocation && matchesDate && matchesAvailability;
  }).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    const aTime = a.start_time ? new Date(a.start_time).getTime() : Infinity;
    const bTime = b.start_time ? new Date(b.start_time).getTime() : Infinity;
    return aTime - bTime;
  });
  const hasFilters = search || location || date || availabilityFilter !== "all" || sort !== "soonest";

  function clearFilters() {
    setSearch("");
    setLocation("");
    setDate("");
    setAvailabilityFilter("all");
    setSort("soonest");
  }

  return (
    <section className="card browse-events-page" aria-labelledby="events-title">
      <div className="explore-heading"><div><p className="eyebrow">FIND YOUR NEXT EXPERIENCE</p><h1 id="events-title">Events</h1></div><span className="explore-heading__note"><Icon name="compass" /> A little discovery goes a long way.</span></div>
      <div className="explore-hero">
        <div className="explore-hero__copy"><span className="explore-hero__tag">GOOD THINGS HAPPEN TOGETHER</span><h2>Make room for<br />something great.</h2><p>New ideas. Meaningful connections.<br />Find an event worth showing up for.</p><a href="#explore-results" className="explore-hero__link">Explore events <Icon name="arrow" size={18} /></a></div>
        <div className="explore-art" aria-hidden="true"><div className="explore-art__orbit" /><div className="explore-art__arch" /><div className="explore-art__circle" /><div className="explore-art__step" /><span className="explore-art__label">IDEAS MEET PEOPLE.</span></div>
      </div>
      <div className="explore-toolbar" role="search" aria-label="Find events">
        <div className="explore-search"><label htmlFor="event-search">Search events</label><div><Icon name="search" /><input id="event-search" type="search" placeholder="Search by name or description" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
        <div><label htmlFor="event-location">Location</label><select id="event-location" value={location} onChange={event => setLocation(event.target.value)}><option value="">All locations</option>{locations.map(city => <option key={city} value={city}>{city}</option>)}</select></div>
        <div><label htmlFor="event-date">From date</label><input id="event-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></div>
        <div><label htmlFor="event-availability">Availability</label><select id="event-availability" value={availabilityFilter} onChange={event => setAvailabilityFilter(event.target.value)}><option value="all">All events</option><option value="available">Places available</option><option value="full">Full events</option></select></div>
      </div>
      <div className="explore-results-heading" id="explore-results"><div><h2>Find your next event</h2><p aria-live="polite">{events ? `${visibleEvents.length} ${visibleEvents.length === 1 ? "event" : "events"} to explore` : "Discover what’s happening"}</p></div><div className="explore-sort">{hasFilters && <button type="button" className="explore-clear" onClick={clearFilters}>Clear filters</button>}<label htmlFor="event-sort">Sort by</label><select id="event-sort" value={sort} onChange={event => setSort(event.target.value)}><option value="soonest">Soonest first</option><option value="name">Event name</option></select></div></div>
      {error ? (
        <div className="explore-empty"><p className="error" role="alert">{error}</p><button className="secondary" onClick={reload}>Try again</button></div>
      ) : !events ? (
        <div role="status"><p>Loading events…</p><div className="event-skeletons" aria-hidden="true">{[1, 2, 3].map(item => <div key={item} />)}</div></div>
      ) : events.length === 0 ? (
        <div className="explore-empty"><Icon name="calendar" size={32} /><h3>More experiences are on the way</h3><p>No approved events are currently available.</p><button className="secondary" onClick={reload}>Refresh events</button></div>
      ) : visibleEvents.length === 0 ? (
        <div className="explore-empty"><Icon name="search" size={32} /><h3>No events match your filters</h3><p>Try another search, location or date.</p><button className="secondary" onClick={clearFilters}>Clear filters</button></div>
      ) : (
        <ul className="event-list" aria-label="Available events">
          {visibleEvents.map((event, index) => (
            <EventListItem key={event.id} event={{ ...event, ...windows.get(event.id) }} serverTime={windowData?.server_time} serverTimeReceivedAt={receivedAt} refreshServerTime={refresh} availability={getRegistrationAvailability(event)} index={index} />
          ))}
        </ul>
      )}
      <div className="explore-footnote"><Icon name="shield" size={16} /><span>Your next experience, with the details that matter. Availability is checked again when you register.</span></div>
    </section>
  );
}

function EventListItem({ event, serverTime, serverTimeReceivedAt, refreshServerTime, availability, index }) {
  const windowState = useRegistrationWindow(event, serverTime, serverTimeReceivedAt, refreshServerTime);
  const venues = (event.venue_booking_requests ?? []).map(booking => booking.venue?.name).filter(Boolean);
  return (
    <li>
      <Link to={`/events/${event.id}`} className="event-list__item">
        <div className={`event-list__art event-list__art--${index % 3}`} aria-hidden="true"><span /><i /><b /><em>CONNECT / EXPERIENCE</em></div>
        <div className="event-list__content">
          {event.start_time && <span className="event-list__date"><Icon name="calendar" size={15} />{formatDate(event.start_time)}</span>}
          <span className="event-list__name">{event.name}</span>
          {venues.length > 0 && <span className="event-list__venue"><Icon name="pin" size={15} />{venues.join(" · ")}</span>}
          {event.description && <p className="event-list__desc">{event.description}</p>}
          <div className="event-list__footer"><span className={`event-list__availability${availability.isFull ? " is-full" : ""}`}>{registrationAvailabilityLabel(event)}</span><Icon name="arrow" size={18} /></div>
          {!availability.isFull && <RegistrationWindowNotice event={event} state={windowState} showRetry={false} />}
        </div>
      </Link>
    </li>
  );
}
