import { useState, useEffect } from "react";
import { fetchVenues, fetchVenueById } from "../../../lib/api";
import VenueCard from "../components/VenueCard";
import VenueDetail from "../components/VenueDetail";

function VenueCataloguePage() {
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [cityFilter, setCityFilter] = useState("");
  const [minCapacityFilter, setMinCapacityFilter] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    fetchVenues({ city: cityFilter, minCapacity: minCapacityFilter })
      .then((data) => setVenues(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [cityFilter, minCapacityFilter]);

  function handleSelectVenue(id) {
    setError(null);
    fetchVenueById(id)
      .then((data) => setSelectedVenue(data))
      .catch((err) => setError(err.message));
  }

  if (selectedVenue) {
    return (
      <VenueDetail
        venue={selectedVenue}
        onBack={() => setSelectedVenue(null)}
      />
    );
  }

  return (
    <div className="venue-catalogue">
      <h2>Venue catalogue</h2>

      <div className="venue-filters">
        <label>
          City
          <input
            type="text"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            placeholder="e.g. Singapore"
          />
        </label>

        <label>
          Minimum capacity
          <input
            type="number"
            min="0"
            value={minCapacityFilter}
            onChange={(e) => setMinCapacityFilter(e.target.value)}
            placeholder="e.g. 100"
          />
        </label>
      </div>

      {isLoading && <p>Loading venues...</p>}
      {error && <p className="venue-error">Could not load venues: {error}</p>}

      {!isLoading && !error && venues.length === 0 && (
        <p>No venues match those filters.</p>
      )}

      <div className="venue-list">
        {venues.map((venue) => (
          <VenueCard
            key={venue.id}
            venue={venue}
            onSelect={handleSelectVenue}
          />
        ))}
      </div>
    </div>
  );
}

export default VenueCataloguePage;