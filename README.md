# MeetingToAction

**Turn a meeting transcript into an execution-ready action pack.**

MeetingToAction reads a meeting transcript and produces the things that usually fall through the
cracks afterwards: the decisions (with owners), the action items (with status), the risks and open
questions, an execution plan, and a drafted follow-up email — every line traceable to the
transcript, and nothing sent until a human approves. Built with the **OpenAI Agents SDK** for the
HCLTech–OpenAI Agentic AI Hackathon (Track 2 — Enterprise productivity).

## The problem

Decisions and commitments made in meetings evaporate. Someone has to re-listen or re-read, chase
owners and dates, write the recap and the follow-ups. It rarely happens consistently, so work
slips.

## What it does

- **Extracts** the meeting title, summary, participants, decisions, action items, risks and open
  questions — each backed by a citation to the transcript line.
- **Plans execution**: workstreams, project updates, calendar follow-ups and blockers, with a
  routing decision (ready to send / needs review / blocked) and confidence.
- **Drafts the follow-up email** to participants, grounded in what was actually said.
- **Human in the loop**: approve & queue the follow-up, return for edit, **override the route**,
  add a note, **reopen**, or **add notes and re-run** the whole pack.

## How it works

```
transcript
   └─ ExtractorAgent → PlannerAgent → FollowUpAgent → Manager
      (decisions,      (workstreams,   (follow-up      (action pack +
       actions,         updates,        email)          audit log)
       risks, cites)    blockers)                         │
                                                          └─► HUMAN: approve / return /
                                                              override / reopen / re-run
```

## Tech stack

- **Backend**: Python, FastAPI, OpenAI Agents SDK; live progress over Server-Sent Events.
- **Frontend**: custom single-page UI — a horizontal stepper and a board with an action-item
  **kanban grouped by status** (no framework, no build step).

## Project structure

```
agents_pipeline.py   the agents, models and finalize logic
server.py            FastAPI app (process, events/SSE, finalize)
web/                 index.html · style.css · app.js
synthetic_data/      meetings/ (3 sample transcripts)
```

## Getting started

You need an **OpenAI API key** (platform.openai.com — pay-as-you-go). A run costs a few cents.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # set OPENAI_API_KEY
python server.py
```

Open http://127.0.0.1:8020.

## Using it

1. Pick a sample meeting (product launch sync, incident review, sales handoff) — or paste your own
   transcript.
2. Press **Generate action pack** and watch the stepper: extract → plan → follow-up → review.
3. Review the board: meeting summary, action items on a kanban by status (ready / needs owner /
   needs date / blocked), decisions and risks with line citations, the execution plan, and the
   drafted follow-up email.
4. **Approve & queue** the follow-up or **return for edit**; optionally **override the route**, add
   a note, **reopen**, or **add notes and re-run**. Everything is logged and exportable.

## Bring your own API key

No key in your `.env`? Click **Add API key** in the top bar and paste your own OpenAI key. It is
stored only in your browser (localStorage) and sent to your local server with each request; the
server falls back to its `.env` key if none is set. Never commit your key to the repo.

## Notes

All transcripts are **synthetic**. MeetingToAction prepares the pack and the follow-up; a human
approves before anything is sent.
