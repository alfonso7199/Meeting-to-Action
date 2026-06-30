"""
MeetingToAction - turn meeting transcripts into execution-ready action packs.

This idea is intentionally outside the HCL Top15 list: a universal enterprise
operations assistant for meetings, with citations back to transcript lines and a
human approval step before sending follow-ups.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from agents import Agent, Runner

load_dotenv()

MODEL = os.getenv("M2A_MODEL", "gpt-4o")
CONFIDENCE_THRESHOLD = 0.72


class Citation(BaseModel):
    line: str = Field(description="Transcript line id, e.g. L04")
    quote: str = Field(description="Short verbatim support from the line")


class Decision(BaseModel):
    decision: str
    owner: Optional[str] = None
    citations: list[Citation] = Field(default_factory=list)


class ActionItem(BaseModel):
    task: str
    owner: str
    due: Optional[str] = None
    status: str = Field(description="ready | blocked | needs_owner | needs_date")
    citations: list[Citation] = Field(default_factory=list)


class MeetingExtract(BaseModel):
    meeting_title: str
    summary: str
    participants: list[str] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)


class ExecutionPlan(BaseModel):
    route: str = Field(description="ready_to_send | needs_review | blocked")
    confidence: float = Field(ge=0.0, le=1.0)
    workstreams: list[str] = Field(default_factory=list)
    project_updates: list[str] = Field(default_factory=list)
    calendar_followups: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    requires_human_review: bool = False


class FollowUpDraft(BaseModel):
    subject: str
    recipients: list[str] = Field(default_factory=list)
    message: str
    citations: list[Citation] = Field(default_factory=list)


class Finalization(BaseModel):
    decision: str = Field(description="approved | rejected")
    action: str = Field(description="followup_queued | returned_for_edit")
    action_summary: str
    next_steps: list[str] = Field(default_factory=list)


@dataclass
class AuditEntry:
    timestamp: str
    agent: str
    summary: str


@dataclass
class MeetingResult:
    extract: MeetingExtract
    plan: ExecutionPlan
    followup: FollowUpDraft
    audit_log: list[AuditEntry] = field(default_factory=list)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def build_extractor_agent() -> Agent:
    return Agent(
        name="ExtractorAgent",
        model=MODEL,
        instructions=(
            "Extract meeting decisions, action items, risks and open questions. "
            "Every decision and action item must include citations to transcript "
            "line ids like L04. Do not invent owners or due dates; if missing, mark "
            "the item as needs_owner or needs_date and include the gap in "
            "missing_fields. Preserve dates exactly as stated in the transcript; "
            "for these synthetic 2026 transcripts, never convert dates to another "
            "year. Keep wording crisp and execution-oriented."
        ),
        output_type=MeetingExtract,
    )


def build_planner_agent() -> Agent:
    return Agent(
        name="PlannerAgent",
        model=MODEL,
        instructions=(
            "Create an execution plan from the extract. Route ready_to_send when "
            "most actions have owners and dates; needs_review when minor gaps or "
            "risks exist; blocked when essential ownership or dates are missing. "
            f"If confidence is below {CONFIDENCE_THRESHOLD} or route is not "
            "ready_to_send, set requires_human_review=true."
        ),
        output_type=ExecutionPlan,
    )


def build_followup_agent() -> Agent:
    return Agent(
        name="FollowUpAgent",
        model=MODEL,
        instructions=(
            "Draft a concise follow-up email for meeting participants. Include "
            "decisions, action items, owners, due dates, risks and open questions. "
            "Do not claim tasks were created in external systems; say they are "
            "ready for approval. Include transcript citations for important claims. "
            "Never use placeholder names or bracketed placeholders. Sign exactly as "
            "MeetingToAction Coordination Desk."
        ),
        output_type=FollowUpDraft,
    )


async def run_pipeline(
    transcript: str,
    on_progress: Optional[Callable[[str, str], None]] = None,
) -> MeetingResult:
    def notify(agent: str, status: str) -> None:
        if on_progress:
            on_progress(agent, status)

    audit: list[AuditEntry] = []

    notify("ExtractorAgent", "Extracting decisions, actions and risks...")
    extract_res = await Runner.run(build_extractor_agent(), input=transcript)
    extract: MeetingExtract = extract_res.final_output
    audit.append(
        AuditEntry(
            _now(),
            "ExtractorAgent",
            f"decisions={len(extract.decisions)}; actions={len(extract.action_items)}; "
            f"gaps={extract.missing_fields or 'none'}",
        )
    )

    notify("PlannerAgent", "Building execution plan...")
    plan_res = await Runner.run(
        build_planner_agent(),
        input=extract.model_dump_json(indent=2),
    )
    plan: ExecutionPlan = plan_res.final_output
    if plan.confidence < CONFIDENCE_THRESHOLD:
        plan.requires_human_review = True
    audit.append(
        AuditEntry(
            _now(),
            "PlannerAgent",
            f"route={plan.route}; confidence={plan.confidence:.2f}; "
            f"human_review={plan.requires_human_review}",
        )
    )

    notify("FollowUpAgent", "Drafting participant follow-up...")
    followup_input = (
        "EXTRACT:\n"
        + extract.model_dump_json(indent=2)
        + "\n\nPLAN:\n"
        + plan.model_dump_json(indent=2)
    )
    followup_res = await Runner.run(build_followup_agent(), input=followup_input)
    followup: FollowUpDraft = followup_res.final_output
    audit.append(
        AuditEntry(
            _now(),
            "FollowUpAgent",
            f"follow-up drafted for {len(followup.recipients)} recipient(s)",
        )
    )

    notify("Manager", "Action pack ready for human review.")
    return MeetingResult(extract=extract, plan=plan, followup=followup, audit_log=audit)


async def finalize_pack(
    extract: dict,
    plan: dict,
    followup: dict,
    decision: str,
    reviewer_note: str = "",
) -> Finalization:
    agent = Agent(
        name="ActionAgent",
        model=MODEL,
        instructions=(
            "A human reviewer approved or rejected a meeting action pack. If "
            "approved, action=followup_queued and explain that follow-up, project "
            "updates and calendar follow-ups are queued for sending/creation. If "
            "rejected, action=returned_for_edit. Do not claim external systems were "
            "actually updated."
        ),
        output_type=Finalization,
    )
    note = f"\n\nREVIEWER NOTE:\n{reviewer_note}" if reviewer_note.strip() else ""
    prompt = (
        f"DECISION: {decision}\n\n"
        f"EXTRACT:\n{json.dumps(extract, ensure_ascii=False)}\n\n"
        f"PLAN:\n{json.dumps(plan, ensure_ascii=False)}\n\n"
        f"FOLLOWUP:\n{json.dumps(followup, ensure_ascii=False)}"
        f"{note}"
    )
    res = await Runner.run(agent, input=prompt)
    return res.final_output
