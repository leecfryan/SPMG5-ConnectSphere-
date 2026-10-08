import { IconCheck } from "./VenueIcons";

// A set of toggleable chips. Written for the booking request form (SCRUM-21)
// and lifted out of it when the venue search (SCRUM-18) needed the same control
// for filtering, rather than keeping a second copy.
//
// `emptyLabel` differs by caller: the form says a venue records none of these,
// while the search says the catalogue offers none.
function ChipToggleGroup({ legend, options, selected, onToggle, emptyLabel }) {
  return (
    <fieldset className="v-fieldset">
      <legend>{legend}</legend>
      {options.length === 0 ? (
        <p className="v-none">{emptyLabel}</p>
      ) : (
        <div className="v-chips">
          {options.map((item) => {
            const isSelected = selected.includes(item);
            return (
              <label
                key={item}
                className={`v-chip-toggle ${isSelected ? "is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(item)}
                />
                <IconCheck size={14} />
                {item}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export default ChipToggleGroup;
