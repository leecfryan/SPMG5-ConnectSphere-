import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { fetchVenues } from "../../../lib/api";
import VenueCard from "../components/VenueCard";
import ChipToggleGroup from "../components/ChipToggleGroup";
import { IconAlert, IconCalendar, IconInbox, IconSearch, IconUsers } from "../components/VenueIcons";

const SKELETON_CARDS = [0, 1, 2];

// SCRUM-18: the same three slots the calendar and booking form use.
const SLOTS = ["am", "pm", "night"];
const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

function toggle(list, item) {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

// Filter options come from the catalogue itself rather than a hard-coded list,
// so a venue gaining a facility makes it filterable with no code change. Read
// from an unfiltered load so the options stay put while filtering narrows the
// results.
function optionsFrom(venues, field) {
  return [...new Set(venues.flatMap((venue) => venue[field] || []))].sort();
}

export default function VenueCataloguePage() {
  const { token, hasPermission } = useAuth();
  const navigate = useNavigate();

  const [cityFilter, setCityFilter] = useState("");
  const [minCapacityFilter, setMinCapacityFilter] = useState("");
  const [facilities, setFacilities] = useState([]);
  const [accessibility, setAccessibility] = useState([]);
  const [roomLayout, setRoomLayout] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [slotFilter, setSlotFilter] = useState([]);

  const [catalogue, setCatalogue] = useState([]);
  const [result, setResult] = useState(null);

  const queryKey = JSON.stringify([
    cityFilter, minCapacityFilter, facilities, accessibility, roomLayout, dateFilter, slotFilter, token,
  ]);
  const current = result?.key === queryKey;
  const isLoading = !current;
  const venues = current ? result.venues : [];
  const error = current ? result.error : null;

  const facilityOptions = optionsFrom(catalogue, "facilities");
  const accessibilityOptions = optionsFrom(catalogue, "accessibility_features");
  const layoutOptions = optionsFrom(catalogue, "room_layouts");
  const hasFilters =
    Boolean(cityFilter || minCapacityFilter || roomLayout || dateFilter) ||
    facilities.length > 0 ||
    accessibility.length > 0;

  // One unfiltered load, only to populate the filter options.
  useEffect(() => {
    let active = true;
    fetchVenues({}, token)
      .then((all) => { if (active) setCatalogue(all); })
      .catch(() => { if (active) setCatalogue([]); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    let active = true;
    fetchVenues(
      {
        city: cityFilter,
        minCapacity: minCapacityFilter,
        facilities,
        accessibility,
        roomLayout,
        date: dateFilter,
        slots: slotFilter,
      },
      token
    )
      .then((venues) => { if (active) setResult({ key: queryKey, venues }); })
      .catch((err) => { if (active) setResult({ key: queryKey, venues: [], error: err.message }); });
    return () => { active = false; };
  }, [cityFilter, minCapacityFilter, facilities, accessibility, roomLayout, dateFilter, slotFilter, token, queryKey]);

  function clearFilters() {
    setCityFilter("");
    setMinCapacityFilter("");
    setFacilities([]);
    setAccessibility([]);
    setRoomLayout("");
    setDateFilter("");
    setSlotFilter([]);
  }

  return (
    <>
        <header className="v-page-header">
          <div>
            <p className="v-eyebrow">Venues</p>
            <h1 className="v-title">Venue catalogue</h1>
            <p className="v-subtitle">
              Narrow the catalogue by what your event needs, check availability,
              and request a booking.
            </p>
          </div>

          {/* Both staff reviewers and assigned coordinators use this queue. */}
          {hasPermission("bookings.read") && <div className="v-actions">
            <button
              type="button"
              className="v-btn v-btn-secondary"
              onClick={() => navigate("/venues/booking-requests")}
            >
              <IconInbox />
              Review booking requests
            </button>
          </div>}
        </header>

        <div className="v-card v-toolbar">
          <label className="v-field">
            <span className="v-label">City</span>
            <span className="v-input-with-icon">
              <IconSearch />
              <input
                className="v-input"
                type="text"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                placeholder="e.g. Singapore"
              />
            </span>
          </label>

          <label className="v-field">
            <span className="v-label">Minimum capacity</span>
            <span className="v-input-with-icon">
              <IconUsers />
              <input
                className="v-input"
                type="number"
                min="0"
                step="1"
                value={minCapacityFilter}
                onChange={(e) => setMinCapacityFilter(e.target.value)}
                placeholder="e.g. 100"
              />
            </span>
          </label>

          {/* SCRUM-18 AC1: free on this date, in the slots ticked below. */}
          <label className="v-field">
            <span className="v-label">Free on</span>
            <span className="v-input-with-icon">
              <IconCalendar />
              <input
                className="v-input"
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </span>
          </label>

          <label className="v-field">
            <span className="v-label">Room layout</span>
            <select
              className="v-input"
              value={roomLayout}
              onChange={(e) => setRoomLayout(e.target.value)}
            >
              <option value="">Any layout</option>
              {layoutOptions.map((layout) => (
                <option key={layout} value={layout}>{layout}</option>
              ))}
            </select>
          </label>

          {!isLoading && !error && (
            <p className="v-toolbar-meta">
              {venues.length} {venues.length === 1 ? "venue" : "venues"}
            </p>
          )}
        </div>

        <div className="v-card v-toolbar">
          <fieldset className="v-fieldset">
            <legend>Slots needed</legend>
            {dateFilter === "" ? (
              <p className="v-none">Pick a date first</p>
            ) : (
              <div className="v-chips">
                {SLOTS.map((slot) => {
                  const isSelected = slotFilter.includes(slot);
                  return (
                    <label
                      key={slot}
                      className={`v-chip-toggle ${isSelected ? "is-selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => setSlotFilter((current) => toggle(current, slot))}
                      />
                      {SLOT_LABELS[slot]}
                    </label>
                  );
                })}
              </div>
            )}
            <span className="v-hint">
              {slotFilter.length === 0
                ? "No slot ticked means any slot that day."
                : "A venue is shown only if every ticked slot is still open."}
            </span>
          </fieldset>

          <ChipToggleGroup
            legend="Facilities needed"
            options={facilityOptions}
            selected={facilities}
            onToggle={(item) => setFacilities((current) => toggle(current, item))}
            emptyLabel="None recorded in the catalogue"
          />

          <ChipToggleGroup
            legend="Accessibility needed"
            options={accessibilityOptions}
            selected={accessibility}
            onToggle={(item) => setAccessibility((current) => toggle(current, item))}
            emptyLabel="None recorded in the catalogue"
          />

          {hasFilters && (
            <button type="button" className="v-btn v-btn-secondary" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {/* SCRUM-18 AC4: this narrows the catalogue to candidates. It is not an
            assessment, so nothing here is scored or ranked. */}
        <p className="v-hint">
          These are potential venues. Check each one against your event before
          requesting it.
        </p>

        {error && (
          <p className="v-alert v-alert-error" role="alert">
            <IconAlert />
            <span>Could not load venues: {error}</span>
          </p>
        )}

        {isLoading && (
          <div className="v-venue-grid" aria-label="Loading venues...">
            {SKELETON_CARDS.map((key) => (
              <div key={key} className="v-card v-skeleton-card">
                <div className="v-skeleton" style={{ width: 46, height: 46 }} />
                <div className="v-skeleton" style={{ width: "70%", height: 18 }} />
                <div className="v-skeleton" style={{ width: "45%", height: 14 }} />
                <div className="v-skeleton" style={{ width: "90%", height: 28 }} />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !error && venues.length === 0 && (
          <div className="v-card v-empty">
            <div className="v-empty-icon">
              <IconSearch size={22} />
            </div>
            <p className="v-empty-title">No venues match those filters.</p>
            <p>Try fewer requirements, a lower capacity, or a different date.</p>
          </div>
        )}

        {!isLoading && venues.length > 0 && (
          <div className="v-venue-grid">
            {venues.map((venue) => (
              <VenueCard key={venue.id} venue={venue} onSelect={(id) => navigate(`/venues/${id}`)} />
            ))}
          </div>
        )}
    </>
  );
}
