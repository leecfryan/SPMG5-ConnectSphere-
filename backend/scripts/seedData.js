const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const supabase = require("../src/supabase");

// Fixed UUIDs so repeated runs are idempotent.
const makeEvents = (organiserId) => [
  {
    id: "aaaaaaaa-0001-0000-0000-000000000000",
    name: "Tech Connect 2026",
    status: "APPROVED",
    description: "Annual technology networking event for professionals and enthusiasts.",
    purpose: "Bring together the local tech community for networking and knowledge sharing.",
    start_time: "2026-11-15T09:00:00Z",
    end_time: "2026-11-15T17:00:00Z",
    expected_attendance: 150,
    other_comments: "Bring your own laptop. Lunch provided.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "dietary", label: "Dietary requirements", type: "text", required: false },
      { id: "company", label: "Company or organisation", type: "text", required: false },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0002-0000-0000-000000000000",
    name: "Community Workshop: Intro to Data Science",
    status: "APPROVED",
    description: "Hands-on workshop covering the basics of data science and machine learning.",
    purpose: "Provide an accessible entry point to data science for community members.",
    start_time: "2026-10-20T13:00:00Z",
    end_time: "2026-10-20T16:00:00Z",
    expected_attendance: 40,
    other_comments: "No prior experience required. Bring a laptop.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "experience", label: "Prior coding experience (if any)", type: "text", required: false },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0003-0000-0000-000000000000",
    name: "Networking Night",
    status: "DRAFT",
    description: "Casual evening for professionals to connect informally.",
    purpose: "Connect local professionals in an informal setting.",
    start_time: "2026-12-05T18:00:00Z",
    end_time: "2026-12-05T21:00:00Z",
    expected_attendance: 60,
    other_comments: null,
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0004-0000-0000-000000000000",
    name: "Career Fair: Tech & Design",
    status: "APPROVED",
    description: "Meet recruiters from leading tech and design companies in one afternoon.",
    purpose: "Connect job seekers with employers across tech and creative industries.",
    start_time: "2026-10-30T13:00:00Z",
    end_time: "2026-10-30T17:00:00Z",
    expected_attendance: 200,
    venue_requirements: "Large hall with booth space for up to 30 exhibitors.",
    other_comments: "Bring printed resumes. Smart casual dress recommended.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "industry", label: "Industry of interest", type: "text", required: false },
      { id: "cv_link", label: "Link to your CV or LinkedIn", type: "text", required: false },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0005-0000-0000-000000000000",
    name: "Volunteer Orientation: Summer Programs",
    status: "APPROVED",
    description: "Onboarding session for volunteers joining the summer community programs.",
    purpose: "Prepare volunteers with the information and tools they need before programs begin.",
    start_time: "2026-09-28T10:00:00Z",
    end_time: "2026-09-28T12:00:00Z",
    expected_attendance: 25,
    other_comments: "Attendance mandatory for all incoming volunteers.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "availability", label: "Availability (days/times)", type: "text", required: true },
      { id: "emergency_contact", label: "Emergency contact name and number", type: "text", required: true },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0006-0000-0000-000000000000",
    name: "Digital Literacy for Seniors",
    status: "SUBMITTED",
    description: "Beginner-friendly workshop teaching smartphone and internet basics to older adults.",
    purpose: "Reduce the digital divide and improve confidence with everyday technology.",
    start_time: "2026-11-08T10:00:00Z",
    end_time: "2026-11-08T12:30:00Z",
    expected_attendance: 20,
    accessibility_needs: "Wheelchair accessible venue required. Large-print handouts.",
    other_comments: "Devices provided. Participants should bring their own phone if they have one.",
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0007-0000-0000-000000000000",
    name: "Youth Leadership Summit",
    status: "APPROVED",
    description: "A one-day summit for young leaders aged 18–30 to develop skills in communication, teamwork, and civic engagement.",
    purpose: "Empower the next generation of community leaders through workshops and peer networking.",
    start_time: "2026-10-10T08:30:00Z",
    end_time: "2026-10-10T17:30:00Z",
    expected_attendance: 80,
    other_comments: "Breakfast and lunch provided. Wear comfortable clothing.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "age", label: "Age", type: "text", required: true },
      { id: "why_attend", label: "Why do you want to attend?", type: "text", required: true },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0008-0000-0000-000000000000",
    name: "Photography Walk: Heritage Districts",
    status: "APPROVED",
    description: "A guided photography walk through the city's heritage districts with tips from a professional photographer.",
    purpose: "Combine community exploration with creative skill-building.",
    start_time: "2026-11-22T08:00:00Z",
    end_time: "2026-11-22T11:30:00Z",
    expected_attendance: 20,
    other_comments: "Bring your own camera or smartphone. Meet at the main entrance.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "equipment", label: "What camera or device will you bring?", type: "text", required: false },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0009-0000-0000-000000000000",
    name: "Community Health Fair",
    status: "APPROVED",
    description: "Free health screenings, wellness talks, and resource stalls from local health and social service providers.",
    purpose: "Improve community access to health information and preventive care.",
    start_time: "2026-12-12T10:00:00Z",
    end_time: "2026-12-12T16:00:00Z",
    expected_attendance: 300,
    accessibility_needs: "Fully wheelchair accessible venue required.",
    other_comments: "Walk-ins welcome but pre-registration helps with planning.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "age_group", label: "Age group", type: "text", required: false },
      { id: "dietary", label: "Dietary requirements", type: "text", required: false },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0010-0000-0000-000000000000",
    name: "Startup Pitch Night",
    status: "APPROVED",
    description: "Watch early-stage founders pitch their ideas to a panel of investors and industry mentors.",
    purpose: "Support the local startup ecosystem and connect founders with potential backers.",
    start_time: "2026-11-05T18:00:00Z",
    end_time: "2026-11-05T21:00:00Z",
    expected_attendance: 100,
    other_comments: "Networking drinks provided after the pitches.",
    registration_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true },
      { id: "company", label: "Company or organisation (if applicable)", type: "text", required: false },
      { id: "role", label: "Your role (e.g. founder, investor, curious attendee)", type: "text", required: false },
    ],
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0011-0000-0000-000000000000",
    name: "Parent & Child Coding Workshop",
    status: "SUBMITTED",
    description: "A fun, hands-on session where parents and children build simple games together using block-based coding.",
    purpose: "Make coding approachable for families and spark early interest in computational thinking.",
    start_time: "2026-12-19T10:00:00Z",
    end_time: "2026-12-19T12:30:00Z",
    expected_attendance: 30,
    other_comments: "For children aged 7–12. Devices provided.",
    organiser_id: organiserId,
  },
  {
    id: "aaaaaaaa-0012-0000-0000-000000000000",
    name: "End-of-Year Staff Appreciation Dinner",
    status: "DRAFT",
    description: "Annual dinner to recognise staff contributions across all programs and departments.",
    purpose: "Celebrate the team and close the year on a high note.",
    start_time: "2026-12-18T19:00:00Z",
    end_time: "2026-12-18T22:00:00Z",
    expected_attendance: 70,
    venue_requirements: "Private dining room for up to 80 pax. AV setup for short presentations.",
    organiser_id: organiserId,
  },
];

const REGISTRATIONS_BY_EMAIL = [
  // attendee1 — spread across all approved events, mix of statuses
  {
    attendeeEmail: "attendee1.demo@example.com",
    eventId: "aaaaaaaa-0001-0000-0000-000000000000",
    status: "pending",
    registration_data: { full_name: "Demo Attendee One", dietary: "Vegetarian", company: "Tech Solutions Pte Ltd" },
  },
  {
    attendeeEmail: "attendee1.demo@example.com",
    eventId: "aaaaaaaa-0002-0000-0000-000000000000",
    status: "confirmed",
    registration_data: { full_name: "Demo Attendee One", experience: "Some Python, completed one online course" },
  },
  {
    attendeeEmail: "attendee1.demo@example.com",
    eventId: "aaaaaaaa-0004-0000-0000-000000000000",
    status: "confirmed",
    registration_data: { full_name: "Demo Attendee One", industry: "Software Engineering", cv_link: "https://linkedin.com/in/demo-attendee-one" },
  },
  {
    attendeeEmail: "attendee1.demo@example.com",
    eventId: "aaaaaaaa-0005-0000-0000-000000000000",
    status: "withdrawn",
    registration_data: { full_name: "Demo Attendee One", availability: "Weekends only", emergency_contact: "Jane Doe, +65 9123 4567" },
  },
  // attendee2 — different spread so we can test privacy (their registrations are not visible to attendee1)
  {
    attendeeEmail: "attendee2.demo@example.com",
    eventId: "aaaaaaaa-0001-0000-0000-000000000000",
    status: "confirmed",
    registration_data: { full_name: "Demo Attendee Two", dietary: "None", company: "Freelance" },
  },
  {
    attendeeEmail: "attendee2.demo@example.com",
    eventId: "aaaaaaaa-0004-0000-0000-000000000000",
    status: "pending",
    registration_data: { full_name: "Demo Attendee Two", industry: "UX Design", cv_link: "https://linkedin.com/in/demo-attendee-two" },
  },
  {
    attendeeEmail: "attendee2.demo@example.com",
    eventId: "aaaaaaaa-0005-0000-0000-000000000000",
    status: "confirmed",
    registration_data: { full_name: "Demo Attendee Two", availability: "Monday to Friday, 9am–5pm", emergency_contact: "Tom Smith, +65 9876 5432" },
  },
];

async function resolveUserIds(emails) {
  const ids = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    for (const user of data.users) {
      if (emails.includes(user.email?.toLowerCase())) {
        ids.set(user.email.toLowerCase(), user.id);
      }
    }
    if (data.users.length < 100) break;
  }
  for (const email of emails) {
    if (!ids.has(email)) {
      throw new Error("User not found in auth.users: " + email + ". Run seed:users first.");
    }
  }
  return ids;
}

async function seedEvents(organiserId) {
  const events = makeEvents(organiserId);
  // Upsert so re-running the script updates event fields if they change.
  const { error } = await supabase.from("events").upsert(events, { onConflict: "id" });
  if (error) {
    // Table might not exist yet if the events team migration hasn't run.
    if (error.code === "42P01") {
      throw new Error("events table does not exist. Apply the events migration before seeding data.");
    }
    throw new Error("Event upsert failed: " + error.message);
  }
  console.log("Events seeded: " + events.length);
}

async function seedRegistrations(userIds) {
  const rows = REGISTRATIONS_BY_EMAIL.map((r) => ({
    event_id: r.eventId,
    attendee_id: userIds.get(r.attendeeEmail),
    status: r.status,
    registration_data: r.registration_data,
  }));

  // ignoreDuplicates: true leaves existing rows untouched (status/data preserved).
  const { error } = await supabase
    .from("registrations")
    .upsert(rows, { onConflict: "attendee_id,event_id", ignoreDuplicates: true });

  if (error) throw new Error("Registration upsert failed: " + error.message);
  console.log("Registrations seeded: " + rows.length + " rows (existing rows skipped).");
}

async function main() {
  const attendeeEmails = [...new Set(REGISTRATIONS_BY_EMAIL.map((r) => r.attendeeEmail))];
  const userIds = await resolveUserIds([...attendeeEmails, "organiser.demo@example.com"]);
  const organiserId = userIds.get("organiser.demo@example.com");
  await seedEvents(organiserId);
  await seedRegistrations(userIds);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
