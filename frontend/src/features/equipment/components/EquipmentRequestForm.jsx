import { useState } from "react";

function EquipmentRequestForm({ equipmentTypes, onSubmit, isSaving, saveError }) {
  const [equipmentTypeId, setEquipmentTypeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [technicalRequirements, setTechnicalRequirements] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      equipment_type_id: equipmentTypeId,
      quantity_requested: Number(quantity),
      technical_requirements:
        technicalRequirements.trim() === "" ? undefined : technicalRequirements.trim(),
    });
  }

  return (
    <form className="equipment-request-form" onSubmit={handleSubmit}>
      <h3>Request equipment</h3>

      <label>
        Equipment type
        <select
          value={equipmentTypeId}
          onChange={(e) => setEquipmentTypeId(e.target.value)}
          required
        >
          <option value="" disabled>
            Select equipment...
          </option>
          {equipmentTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Quantity
        <input
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </label>

      <label>
        Technical requirements (optional)
        <textarea
          rows="3"
          value={technicalRequirements}
          onChange={(e) => setTechnicalRequirements(e.target.value)}
          placeholder="e.g. Needs HDMI and a wireless mic."
        />
      </label>

      {saveError && (
        <p className="equipment-error" role="alert">
          Could not submit request: {saveError}
        </p>
      )}

      <button type="submit" disabled={isSaving || !equipmentTypeId}>
        {isSaving ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

export default EquipmentRequestForm;
