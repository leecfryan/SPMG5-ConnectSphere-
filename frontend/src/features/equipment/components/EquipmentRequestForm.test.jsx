// @vitest-environment jsdom
// Scrum-30: the reserve flow's two-step form - pick a type, then review a
// single-unit reservation (the specific unit is auto-assigned, never shown
// or chosen by the requester).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import EquipmentRequestForm from "./EquipmentRequestForm";

const OPTIONS = [
  { id: "p1", type: "Projector", current_location: "Store A" },
  { id: "p2", type: "Projector", current_location: "Store B" },
  { id: "m1", type: "Microphone", current_location: "Store C" },
];

function setup(overrides = {}) {
  return render(
    <EquipmentRequestForm
      equipmentOptions={OPTIONS}
      borrowWindow={{ start: "2026-10-10T09:00", end: "2026-10-10T17:00" }}
      onWindowChange={vi.fn()}
      onSubmit={vi.fn()}
      isSaving={false}
      saveError={null}
      {...overrides}
    />,
  );
}

describe("Scrum-30: two-step reserve flow", () => {
  it("the type dropdown shows each type once, not one option per unit", () => {
    setup();
    expect(screen.getByRole("option", { name: "Projector" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Microphone" })).toBeInTheDocument();
    expect(screen.queryAllByRole("option", { name: "Projector" })).toHaveLength(1);
  });

  it("the type option never includes the location", () => {
    setup();
    expect(screen.queryByRole("option", { name: /Projector.*Store/i })).not.toBeInTheDocument();
  });

  it("no review summary is shown until a type is picked", () => {
    setup();
    expect(screen.queryByText(/you have requested/i)).not.toBeInTheDocument();
  });

  it("picking a type with available units shows a simple review line, no per-unit list or location", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    expect(screen.getByText("You have requested 1 Projector.")).toBeInTheDocument();
    expect(screen.queryByText("Store A")).not.toBeInTheDocument();
    expect(screen.queryByText("Store B")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("there is no quantity field anywhere in this form", () => {
    setup();
    expect(screen.queryByLabelText(/quantity/i)).not.toBeInTheDocument();
  });

  it("submit is disabled until a type with an available unit is picked", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("submits the first available unit's id with quantity_requested always 1", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    setup({ onSubmit });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Microphone");
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ equipment_id: "m1", quantity_requested: 1 }));
  });

});
