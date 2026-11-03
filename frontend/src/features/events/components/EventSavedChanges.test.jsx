// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,expect,test} from "vitest";
import EventSavedChanges from "./EventSavedChanges";

afterEach(cleanup);
test("[SCRUM-117-BASE-UI-001] current saved edits show a submitted baseline before any resubmission",()=>{
  render(<EventSavedChanges comparison={{source:"SUBMITTED",version_at:"2026-10-24T00:00:00Z",changes:[{field:"expected_attendance",before:30,after:45}]}}/>);
  expect(screen.getByRole("region",{name:"Saved organiser changes"})).toHaveTextContent("Compared with the last submitted version.");
  expect(screen.getByText("30")).toBeInTheDocument();
  expect(screen.getByText("45")).toBeInTheDocument();
});
test("[SCRUM-117-BASE-UI-002] unrecoverable old edits and failed comparison reads are not presented as zero changes",()=>{
  const {rerender}=render(<EventSavedChanges comparison={null}/>);
  expect(screen.getByText(/comparison is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Refresh the event to try again/)).toBeInTheDocument();
  rerender(<EventSavedChanges comparison={{source:"NO_BASELINE",version_at:null,changes:[]}}/>);
  expect(screen.getByText(/no baseline was recorded/i)).toBeInTheDocument();
  expect(screen.queryByText(/Refresh the event to try again/)).not.toBeInTheDocument();
  expect(screen.queryByText("No request fields changed.")).not.toBeInTheDocument();
  rerender(<EventSavedChanges comparison={{source:"TRACKING_STARTED",version_at:"2026-10-24T00:00:00Z",changes:[{field:"name",before:"Old",after:"New"}]}}/>);
  expect(screen.getByText(/Earlier edits are unavailable/)).toBeInTheDocument();
  rerender(<EventSavedChanges comparison={{source:"SUBMITTED",changes:[]}}/>);
  expect(screen.queryByRole("region",{name:"Saved organiser changes"})).not.toBeInTheDocument();
});
