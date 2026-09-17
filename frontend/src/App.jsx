import "./App.css";
import VenueCataloguePage from "./features/venues/pages/VenueCataloguePage";

// Uses the brand header markup and class names from the develop branch App.jsx,
// so the venue pages already sit inside the team's shell styling.
//
// Deliberately not wrapped in <main>: develop's App.css styles `main` as the
// two-column sign-in grid, which would squeeze the venue pages into one column.
function App() {
  return (
    <div className="app-shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        ConnectSphere
      </header>

      <VenueCataloguePage />

      <footer>ConnectSphere Event Services</footer>
    </div>
  );
}

export default App;
