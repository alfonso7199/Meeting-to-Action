# MeetingToAction — Submission & video script

## Submission form answers (copy/paste)

**Agent workflow.** MeetingToAction turns a meeting transcript into an execution-ready action
pack. (1) **ExtractorAgent** pulls the decisions, action items (with owner and status), risks and
open questions — each backed by a **citation to the transcript line**. (2) **PlannerAgent** builds
an execution plan: workstreams, project updates, calendar follow-ups and blockers, with a routing
decision and confidence. (3) **FollowUpAgent** drafts the participant follow-up email grounded in
what was said. (4) A **Manager** assembles the pack and audit log. A human approves & queues the
follow-up, returns it for edit, overrides the route, reopens, or adds notes and re-runs. Nothing
is sent until a human approves.

**OpenAI technology stack.** OpenAI **Agents SDK** (Agent + Runner) with **structured outputs**
(Pydantic `output_type`) on the Responses API; live agent progress streamed over SSE. Models:
GPT-4o class. Built with **Codex**.

---

## Video script (target 4–5 min)

### Part 1 — Pitch deck (~90 seconds)

- **[Slide 1 — Title]** "Hi, I'm ⟨name⟩. This is **MeetingToAction** — turn a meeting transcript
  into an execution-ready action pack. Built with the OpenAI Agents SDK and Codex."
- **[Slide 2 — Problem]** "Decisions and commitments made in meetings evaporate. Someone has to
  re-listen, chase owners and dates, write the recap and the follow-ups — and it rarely happens
  consistently, so work slips."
- **[Slide 3 — How it works]** "Here's the **agent workflow**: ExtractorAgent pulls decisions,
  action items and risks **cited to the transcript line**, PlannerAgent builds the execution plan,
  and FollowUpAgent drafts the participant email. A human approves before anything is sent."
- **[Slide 4 — What the judges see]** "You'll see the action items on a **kanban by status**,
  decisions and risks with citations, the execution plan, and the drafted follow-up."
- **[Slide 5 — Impact & scale]** "Minutes to a complete, cited action pack — every action owned,
  every decision traceable. It works for standups, project syncs, incident reviews, sales
  handoffs."

### Part 2 — Live demo (~3 minutes)

1. "I open MeetingToAction at **localhost:8020**."
2. "First the key: I click **Add API key**, paste my own OpenAI key — anyone can run the repo. Dot
   turns green."
3. "I pick the sample **product launch sync** transcript — no typing."
4. "I click **Generate action pack** and watch the **stepper**: extract → plan → follow-up →
   review, streamed live."
5. "Here's the board. The action items are on a **kanban grouped by status** — Ready, Needs owner,
   Needs date, Blocked. Decisions and risks each show a **citation to the transcript line**, so
   it's verifiable."
6. "There's the execution plan, and the **drafted follow-up email**. I can **override the route**,
   add a note, then **Approve & queue** — or return it for edit. It's all in the audit trail."
7. "If a correction comes in, I **add a note and re-run**. That's MeetingToAction — from talk to
   traction."
