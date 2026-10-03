import { formatDay } from "../eventFormat";

export default function CoordinatorTable({ coordinators, selectedId, onSelect, disabled }) {
  if (coordinators.length === 0) {
    return (
      <p className="assign-empty" role="status">
        No Event Coordinators are set up yet.
      </p>
    );
  }

  return (
    <table className="assign-table">
      <caption>Event Coordinators, with the work they already hold</caption>
      <thead>
        <tr>
          <th scope="col"><span className="visually-hidden">Select</span></th>
          <th scope="col">Coordinator</th>
          <th scope="col">Email</th>
          <th scope="col" className="assign-number">Active events</th>
          <th scope="col">Next event starts</th>
        </tr>
      </thead>
      <tbody>
        {coordinators.map((coordinator) => {
          const name = coordinator.fullName || coordinator.email;
          return (
            <tr key={coordinator.id} className={coordinator.id === selectedId ? "is-selected" : undefined}>
              <td>
                <input
                  type="radio"
                  name="coordinator"
                  value={coordinator.id}
                  checked={coordinator.id === selectedId}
                  disabled={disabled}
                  onChange={() => onSelect(coordinator.id)}
                  aria-label={`Assign to ${name}`}
                />
              </td>
              <th scope="row">{name}</th>
              <td>{coordinator.email}</td>
              <td className="assign-number">{coordinator.activeEvents}</td>
              <td>{formatDay(coordinator.nextEventStart)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
