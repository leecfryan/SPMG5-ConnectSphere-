// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import EventResubmissionChanges from "./EventResubmissionChanges";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
test.each(["en-US", "en-SG"])("[SCRUM-117-UI-R03] The coordinator reads saved changes including dates and cleared optional fields safely (%s)", (locale) => {
  const toLocaleString = Date.prototype.toLocaleString;
  vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (_locale, options) {
    return toLocaleString.call(this, locale, options);
  });
  const saved = { action:"REQUEST_RESUBMITTED",created_at:"2099-01-01T01:00:00Z",changes:[
    {field:"name",before:"Original",after:"<script>alert(1)</script>"},
    {field:"registration_start",before:"2098-12-01T00:00:00Z",after:"2098-12-02T00:00:00Z"},
    {field:"accessibility_needs",before:"Ramp",after:null},
  ] };
  const {container}=render(<EventResubmissionChanges activity={[saved]}/>);
  expect(screen.getByRole("heading",{name:"Event name"})).toBeInTheDocument();
  expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByRole("heading",{name:"Registration start"})).toBeInTheDocument();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  expect(screen.getByText(dateFormat.format(new Date("2098-12-01T00:00:00Z")))).toBeInTheDocument();
  expect(screen.getByText(dateFormat.format(new Date("2098-12-02T00:00:00Z")))).toBeInTheDocument();
  expect(screen.getByText("Ramp")).toBeInTheDocument();
  expect(screen.getByText("Not provided")).toBeInTheDocument();
});
test("[SCRUM-117-UI-R04] A later unchanged resubmission is explicit rather than showing stale changes", () => {
  render(<EventResubmissionChanges activity={[
    {action:"REQUEST_RESUBMITTED",created_at:"2099-01-02T00:00:00Z",changes:[]},
    {action:"REQUEST_RESUBMITTED",created_at:"2099-01-01T00:00:00Z",changes:[{field:"name",before:"Old",after:"Prior cycle"}]},
  ]}/>);
  expect(screen.getByText("No request fields changed.")).toBeInTheDocument();
  expect(screen.queryByText("Prior cycle")).not.toBeInTheDocument();
});
