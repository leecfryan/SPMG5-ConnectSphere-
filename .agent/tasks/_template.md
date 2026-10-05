# SCRUM-<n> — <story title>

**Backlog ID:** US-<n> · **Epic:** <epic> · **Lane:** <lane> · **Points:** <sp> · **Assignee:** <name>
**Branch:** `feature/<threeWordSummary>` or `fix/<threeWordSummary>` · **Mode:** build | teach
**State:** 📋 planned

## Contract (word for word, as given by the user on <YYYY-MM-DD>)

> **Story:** As a <role>, I want <goal> so that <benefit>.
>
> **Acceptance criteria**
> 1. …
> 2. …

## Plan against the acceptance criteria

| AC | Requirement (short) | How it's built | How it's proven (test IDs, layer) | Done |
|---|---|---|---|---|
| 1 | | | | ☐ |
| 2 | | | | ☐ |

## Test cases

Written and agreed **before** code. Expected results come from the AC and clarifications, never from the code.

| Epic | Scrum-# | AC # | Type | Test Case ID | Test Scenario | Pre-conditions | Test Steps | Test Data | Expected Result | Created By* | Date of Creation* | Actual Result | Pass / Fail / Not Executed / Blocked | Remarks | Executed By | Date of Execution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| <epic> | SCRUM-<n> | 1 | Happy | TC-SCRUM-<n>-01 | | | | | <name> | <YYYY-MM-DD> | | Not Executed | | | |
| <epic> | SCRUM-<n> | 1 | Negative | TC-SCRUM-<n>-02 | | | | | <name> | <YYYY-MM-DD> | | Not Executed | | | |
| <epic> | SCRUM-<n> | 2 | Boundary | TC-SCRUM-<n>-03 | | | | | <name> | <YYYY-MM-DD> | | Not Executed | | | |
| <epic> | SCRUM-<n> | | Conflict | TC-SCRUM-<n>-04 | | | | | <name> | <YYYY-MM-DD> | | Not Executed | | | |
| <epic> | SCRUM-<n> | | Failure | TC-SCRUM-<n>-05 | | | | | <name> | <YYYY-MM-DD> | | Not Executed | | | |

**Coverage** (story's files): backend <lines / branches> · frontend <lines / branches> · gaps and reasons: <…>

**Test review** (five questions): <tests strengthened or removed, and why>

## Deliberately absent

Neighbouring behaviour this story does **not** build, and the story that owns it.

| Behaviour | Belongs to |
|---|---|
| | |

## Decisions

Interpretations of the AC and design choices, with the reason and who agreed.

-

## Touches

- **Shared files:** <app.js / permissions.js / App.jsx / WorkspaceLayout.jsx / Playwright support, or none>
- **Schema change (manual, no migration file):** <none, or the SQL. Added by user on <date>?>
- **New permission:** <none, or name + roles>
- **New routes:** <frontend paths and API endpoints>

## Slices

1. <riskiest AC first>
2.

## Manual demo steps

1. Sign in as `<seeded account>` …
2.

## Explain-back

Plain-language walkthrough for the user and the Week 13 Q&A.

- **AC → test → code:** <for each AC, which test case IDs (`TC-SCRUM-<n>-NN`) and tests prove it, and where the
  code lives>
- **Key decisions and tradeoffs:** <what was chosen, what else was considered, why>
- **Likely instructor questions:** <three questions, each with a short answer>

## Found, not built

Bugs, gaps or missing stories noticed while working. Pass these to the user for the backlog.

-

## Log

- <YYYY-MM-DD> — created; mode chosen: <build/teach>
