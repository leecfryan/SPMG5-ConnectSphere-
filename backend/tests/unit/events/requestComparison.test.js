import { expect, test } from "vitest";
const { compareRequestFields } = require("../../../src/modules/events/requestComparison");

test("[SCRUM-117-BASE-UNIT-001] all twelve editable fields are compared and protected fields are excluded", () => {
  const before = { name:"Original",purpose:"Purpose",description:"Description",start_time:"2099-01-01T01:00:00Z",end_time:"2099-01-01T03:00:00Z",
    registration_start:"2098-12-01T00:00:00Z",registration_end:"2098-12-31T00:00:00Z",expected_attendance:30,
    venue_requirements:"Theatre",accessibility_needs:"Ramp",equipment_needs:"Projector",other_comments:"Notes",status:"SUBMITTED",coordinator_id:"one" };
  const after = { name:"Revised",purpose:"New purpose",description:"New description",start_time:"2099-01-02T01:00:00Z",end_time:"2099-01-02T03:00:00Z",
    registration_start:"2098-12-02T00:00:00Z",registration_end:"2098-12-30T00:00:00Z",expected_attendance:45,
    venue_requirements:"Round tables",accessibility_needs:null,equipment_needs:"Microphone",other_comments:"New notes",status:"UNDER_REVIEW",coordinator_id:"two" };
  expect(compareRequestFields(before,after)).toEqual([
    {field:"name",before:"Original",after:"Revised"},{field:"purpose",before:"Purpose",after:"New purpose"},
    {field:"description",before:"Description",after:"New description"},{field:"start_time",before:before.start_time,after:after.start_time},
    {field:"end_time",before:before.end_time,after:after.end_time},{field:"registration_start",before:before.registration_start,after:after.registration_start},
    {field:"registration_end",before:before.registration_end,after:after.registration_end},{field:"expected_attendance",before:30,after:45},
    {field:"venue_requirements",before:"Theatre",after:"Round tables"},{field:"accessibility_needs",before:"Ramp",after:null},
    {field:"equipment_needs",before:"Projector",after:"Microphone"},{field:"other_comments",before:"Notes",after:"New notes"},
  ]);
});
test("[SCRUM-117-BASE-UNIT-002] equivalent times, empty optional values and reverting an edit produce no net change", () => {
  const before={start_time:"2099-01-01T01:00:00Z",other_comments:null,expected_attendance:30};
  expect(compareRequestFields(before,{start_time:"2099-01-01T09:00:00+08:00",other_comments:"",expected_attendance:30})).toEqual([]);
  expect(compareRequestFields(before,{...before,expected_attendance:45})).toEqual([{field:"expected_attendance",before:30,after:45}]);
  expect(compareRequestFields(before,{...before})).toEqual([]);
});
