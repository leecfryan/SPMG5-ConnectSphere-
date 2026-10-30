// @vitest-environment jsdom
// SCRUM-31: the form reopens the quantity input and adds the "Essential"
// checkbox that SCRUM-30 deliberately removed - that story's own code
// comment flagged this exact reversal as "Scrum-31's job" (no specific unit
// is picked at submission any more; Technical Support's Reserve action
// assigns real units later). The type-dropdown tests below that are still
// true (one option per type, no location shown) are kept; the ones that
// asserted SCRUM-30's single-unit/no-quantity constraint are replaced with
// their SCRUM-31 opposite, not just deleted.
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

describe("SCRUM-31: type + quantity request flow", () => {
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

  it("a quantity field exists, defaulting to 1", () => {
    setup();
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(1);
  });

  it("an Essential checkbox exists, unticked by default (Decision 7)", () => {
    setup();
    expect(screen.getByRole("checkbox", { name: /essential/i })).not.toBeChecked();
  });

  it("submit is disabled until a type is picked; quantity 1 alone is enough", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("submits equipment_type, the chosen quantity, and is_essential - no equipment_id", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    setup({ onSubmit });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Microphone");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "5");
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      equipment_type: "Microphone",
      quantity_requested: 5,
      is_essential: false,
    }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("equipment_id");
  });

  it("TC-SCRUM-31-21: ticking Essential submits is_essential: true", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    setup({ onSubmit });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.click(screen.getByRole("checkbox", { name: /essential/i }));
    await user.click(screen.getByRole("button", { name: /submit request/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_essential: true }));
  });

  // SCRUM-31 Decision 4: this never rejects for insufficient stock - over-
  // requesting more than is currently shown as available is accepted.
  it("a quantity greater than the available units for the type is still submittable", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    setup({ onSubmit });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Microphone");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "10");
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /submit request/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity_requested: 10 }));
  });
});
