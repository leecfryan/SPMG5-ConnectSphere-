// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import WaitlistEntry from "./WaitlistEntry";

afterEach(cleanup);

test("My Registrations shows the server-calculated waitlist position", () => {
  render(
    <AuthContext.Provider value={{ token: "attendee-token" }}>
      <WaitlistEntry
        entry={{
          id: "entry-1",
          event_id: "event-1",
          position: 3,
          event: { name: "Workshop" },
        }}
      />
    </AuthContext.Provider>,
  );

  expect(screen.getByRole("status")).toHaveTextContent("Your waitlist position: 3.");
});
