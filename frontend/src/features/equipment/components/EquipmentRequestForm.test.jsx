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
import { fireEvent, render, screen } from "@testing-library/react";
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
      allEquipment={OPTIONS}
      isAvailabilityUnknown={false}
      borrowWindow={{ start: "2026-10-10T09:00", end: "2026-10-10T17:00" }}
      onWindowChange={vi.fn()}
      onSubmit={vi.fn()}
      isSaving={false}
      saveError={null}
      {...overrides}
    />,
  );
}

// SCRUM-169: N fake units of one type, for building equipmentOptions/
// allEquipment fixtures without depending on the shared OPTIONS above.
function unitsOfType(type, count) {
  return Array.from({ length: count }, (_, i) => ({ id: `${type}-${i}`, type }));
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

// SCRUM-169: the live count / shortfall / Out-of-Stock message under the
// type+quantity fields. Each test builds its own equipmentOptions/
// allEquipment fixture rather than reusing OPTIONS above, so the scenario
// (and the AC/decision it proves) is readable from the test alone.
describe("SCRUM-169: live count, shortfall and Out of Stock messaging", () => {
  it("TC-SCRUM-169-01: count >= quantity shows the bare available-now count", async () => {
    const user = userEvent.setup();
    const projectors = unitsOfType("Projector", 3);
    setup({ equipmentOptions: projectors, allEquipment: projectors });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "2");

    expect(screen.getByText("3 available now.")).toBeInTheDocument();
    expect(screen.queryByText(/only/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Out of Stock")).not.toBeInTheDocument();
  });

  it("TC-SCRUM-169-02: a window-change refetch (new equipmentOptions prop) updates the message with no stale leftover", async () => {
    const user = userEvent.setup();
    const twoProjectors = unitsOfType("Projector", 2);
    const allTypes = unitsOfType("Projector", 2);
    const { rerender } = setup({ equipmentOptions: twoProjectors, allEquipment: allTypes });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "2");
    expect(screen.getByText("2 available now.")).toBeInTheDocument();

    rerender(
      <EquipmentRequestForm
        equipmentOptions={[]}
        allEquipment={allTypes}
        isAvailabilityUnknown={false}
        borrowWindow={{ start: "2026-10-10T09:00", end: "2026-10-10T17:00" }}
        onWindowChange={vi.fn()}
        onSubmit={vi.fn()}
        isSaving={false}
        saveError={null}
      />,
    );

    expect(screen.queryByText("2 available now.")).not.toBeInTheDocument();
    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
  });

  it("TC-SCRUM-169-03: a type with zero units for this window stays selectable and shows Out of Stock, Submit still enabled", async () => {
    const user = userEvent.setup();
    setup({
      equipmentOptions: [], // nothing free for this window
      allEquipment: unitsOfType("Microphone", 1), // but it exists in the catalogue
    });
    expect(screen.getByRole("option", { name: "Microphone" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Microphone");

    expect(screen.getByText("Out of Stock")).toBeInTheDocument();
    expect(screen.getByText("Out of Stock now. You can still submit, but it may be unfulfilled.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("TC-SCRUM-169-04: exactly 1 available unit and quantity 1 shows the count, not Out of Stock (>=/> boundary)", async () => {
    const user = userEvent.setup();
    const oneProjector = unitsOfType("Projector", 1);
    setup({ equipmentOptions: oneProjector, allEquipment: oneProjector });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");

    expect(screen.getByText("1 available now.")).toBeInTheDocument();
    expect(screen.queryByText("Out of Stock")).not.toBeInTheDocument();
  });

  it("TC-SCRUM-169-08: quantity greater than the count shows the shortfall wording, Submit stays enabled", async () => {
    const user = userEvent.setup();
    const twoProjectors = unitsOfType("Projector", 2);
    setup({ equipmentOptions: twoProjectors, allEquipment: twoProjectors });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "5");

    expect(screen.getByText("Only 2 available now, the rest may be unfulfilled.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("TC-SCRUM-169-09: essential + a nonzero shortfall shows the shortfall line AND the essential consequence line", async () => {
    const user = userEvent.setup();
    const threeProjectors = unitsOfType("Projector", 3);
    setup({ equipmentOptions: threeProjectors, allEquipment: threeProjectors });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "5");
    await user.click(screen.getByRole("checkbox", { name: /essential/i }));

    expect(screen.getByText("Only 3 available now, the rest may be unfulfilled.")).toBeInTheDocument();
    expect(screen.getByText(
      "Essential: if there aren't enough units, nothing will be reserved and your request stays pending until enough are free.",
    )).toBeInTheDocument();
  });

  it("TC-SCRUM-169-10: essential + zero available shows Out of Stock (badge first) AND the essential line together", async () => {
    const user = userEvent.setup();
    setup({ equipmentOptions: [], allEquipment: unitsOfType("Projector", 1) });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.click(screen.getByRole("checkbox", { name: /essential/i }));

    const badge = screen.getByText("Out of Stock");
    const essentialLine = screen.getByText(
      "Essential: if there aren't enough units, nothing will be reserved and your request stays pending until enough are free.",
    );
    expect(badge).toBeInTheDocument();
    expect(essentialLine).toBeInTheDocument();
    // badge first: its position in the document precedes the essential line's.
    expect(badge.compareDocumentPosition(essentialLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /submit request/i })).toBeEnabled();
  });

  it("TC-SCRUM-169-11: isAvailabilityUnknown suppresses the whole message, so a loading or errored fetch never flashes Out of Stock", async () => {
    const user = userEvent.setup();
    setup({
      equipmentOptions: [], // the real result hasn't arrived (or the fetch failed) - looks like zero either way
      allEquipment: unitsOfType("Projector", 1),
      isAvailabilityUnknown: true,
    });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");

    expect(screen.queryByText("Out of Stock")).not.toBeInTheDocument();
    expect(screen.queryByText(/available now/i)).not.toBeInTheDocument();
  });

  it("TC-SCRUM-169-12: editing the quantity alone (no new equipmentOptions prop) updates the message", async () => {
    const user = userEvent.setup();
    const threeProjectors = unitsOfType("Projector", 3);
    setup({ equipmentOptions: threeProjectors, allEquipment: threeProjectors });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "2");
    expect(screen.getByText("3 available now.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "5");

    expect(screen.getByText("Only 3 available now, the rest may be unfulfilled.")).toBeInTheDocument();
  });

  it.each([["", "blank"], ["0", "zero"], ["-3", "negative"], ["2.5", "non-integer"]])(
    "TC-SCRUM-169-13: an invalid typed quantity (%s / %s) shows only the bare count, no shortfall comparison",
    async (value) => {
      const twoProjectors = unitsOfType("Projector", 2);
      setup({ equipmentOptions: twoProjectors, allEquipment: twoProjectors });
      await userEvent.setup().selectOptions(screen.getByLabelText("Equipment type"), "Projector");
      fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value } });

      expect(screen.getByText("2 available now.")).toBeInTheDocument();
      expect(screen.queryByText(/only/i)).not.toBeInTheDocument();
    },
  );

  it("TC-SCRUM-169-14: nothing is shown before a type is selected", () => {
    setup({ equipmentOptions: unitsOfType("Projector", 0), allEquipment: unitsOfType("Projector", 1) });
    expect(screen.queryByText(/available now/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Out of Stock")).not.toBeInTheDocument();
  });

  it("TC-SCRUM-169-15: essential ticked but stock is sufficient shows only the bare count, no essential line", async () => {
    const user = userEvent.setup();
    const fiveProjectors = unitsOfType("Projector", 5);
    setup({ equipmentOptions: fiveProjectors, allEquipment: fiveProjectors });
    await user.selectOptions(screen.getByLabelText("Equipment type"), "Projector");
    await user.clear(screen.getByLabelText(/quantity/i));
    await user.type(screen.getByLabelText(/quantity/i), "3");
    await user.click(screen.getByRole("checkbox", { name: /essential/i }));

    expect(screen.getByText("5 available now.")).toBeInTheDocument();
    expect(screen.queryByText(/essential:/i)).not.toBeInTheDocument();
  });
});
