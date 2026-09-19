import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { fetchVenues } from "../../../lib/api";
import VenueCard from "../components/VenueCard";
import { IconAlert, IconInbox, IconSearch, IconUsers } from "../components/VenueIcons";

const SKELETON_CARDS = [0, 1, 2];

export default function VenueCataloguePage() {
  const { token, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [cityFilter, setCityFilter] = useState("");
  const [minCapacityFilter, setMinCapacityFilter] = useState("");
  const [result, setResult] = useState(null);
  const queryKey = JSON.stringify([cityFilter, minCapacityFilter, token]);
  const current = result?.key === queryKey;
  const isLoading = !current;
  const venues = current ? result.venues : [];
  const error = current ? result.error : null;

  useEffect(() => {
    let active = true;
    fetchVenues({ city: cityFilter, minCapacity: minCapacityFilter }, token)
      .then((venues) => { if (active) setResult({ key: queryKey, venues }); })
      .catch((err) => { if (active) setResult({ key: queryKey, venues: [], error: err.message }); });
    return () => { active = false; };
  }, [cityFilter, minCapacityFilter, token, queryKey]);

  return (
    <>
        <header className="v-page-header">
          <div>
            <p className="v-eyebrow">Venues</p>
            <h1 className="v-title">Venue catalogue</h1>
            <p className="v-subtitle">
              Compare venues by location and capacity, check availability, and
              request a booking for your event.
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
                value={minCapacityFilter}
                onChange={(e) => setMinCapacityFilter(e.target.value)}
                placeholder="e.g. 100"
              />
            </span>
          </label>

          {!isLoading && !error && (
            <p className="v-toolbar-meta">
              {venues.length} {venues.length === 1 ? "venue" : "venues"}
            </p>
          )}
        </div>

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
            <p>Try a different city or a lower minimum capacity.</p>
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
