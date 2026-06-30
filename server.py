from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, Form, Header, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agents_pipeline import MeetingResult, finalize_pack, run_pipeline

load_dotenv()

ROOT = Path(__file__).parent
WEB_DIR = ROOT / "web"
MEETINGS_DIR = ROOT / "synthetic_data" / "meetings"

app = FastAPI(title="MeetingToAction")
JOBS: dict[str, asyncio.Queue] = {}


def _example_path(name: str) -> Optional[Path]:
    safe = Path(name.strip()).name
    if not safe:
        return None
    if not safe.endswith(".txt"):
        safe += ".txt"
    candidate = (MEETINGS_DIR / safe).resolve()
    try:
        if candidate.parent == MEETINGS_DIR.resolve() and candidate.exists():
            return candidate
    except OSError:
        return None
    return None


def serialize(result: MeetingResult) -> dict:
    return {
        "extract": result.extract.model_dump(),
        "plan": result.plan.model_dump(),
        "followup": result.followup.model_dump(),
        "audit_log": [asdict(e) for e in result.audit_log],
    }


def friendly_error(e: Exception) -> str:
    low = str(e).lower()
    if "api key" in low or "api_key" in low:
        return "OpenAI API key missing or rejected. Check OPENAI_API_KEY in .env."
    if "rate limit" in low or "quota" in low:
        return "OpenAI rate limit or quota reached."
    return f"{type(e).__name__}: {e}"


def apply_key(key) -> None:
    if key:
        os.environ["OPENAI_API_KEY"] = key
        try:
            from agents import set_default_openai_key
            set_default_openai_key(key)
        except Exception:
            pass


async def run_job(job_id: str, text: str, examples: list[tuple[str, str]], files: list[tuple[str, bytes]], key=None) -> None:
    q = JOBS[job_id]
    apply_key(key)

    def emit(etype: str, **kw) -> None:
        q.put_nowait({"type": etype, **kw})

    try:
        blocks = []
        if text.strip():
            blocks.append(("Pasted transcript", text.strip()))
            emit("evidence", name="Pasted transcript", kind="text")
        for name, body in examples:
            blocks.append((name, body))
            emit("evidence", name=name, kind="example transcript")
        for name, data in files:
            body = data.decode("utf-8", errors="ignore").strip()
            if body:
                blocks.append((name, body))
                emit("evidence", name=name, kind="uploaded transcript")
        transcript = "\n\n".join(f"=== TRANSCRIPT: {name} ===\n{body}" for name, body in blocks)
        if not transcript.strip():
            emit("error", message="No readable transcript found.")
            return

        def on_progress(agent: str, status: str) -> None:
            q.put_nowait({"type": "progress", "agent": agent, "status": status})

        result = await run_pipeline(transcript, on_progress=on_progress)
        emit("result", data=serialize(result), transcript=transcript)
    except Exception as e:  # noqa: BLE001
        emit("error", message=friendly_error(e))
    finally:
        q.put_nowait(None)


@app.get("/api/examples")
async def list_examples() -> JSONResponse:
    return JSONResponse(sorted(p.stem for p in MEETINGS_DIR.glob("*.txt")))


@app.get("/api/example/{name}")
async def get_example(name: str) -> JSONResponse:
    path = _example_path(name)
    if not path:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({"name": path.stem, "text": path.read_text(encoding="utf-8")})


@app.post("/api/process")
async def process(
    text: str = Form(""),
    examples: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    x_openai_key: str = Header(None),
) -> JSONResponse:
    example_texts = []
    for name in [x for x in examples.split(",") if x.strip()]:
        path = _example_path(name)
        if path:
            example_texts.append((path.stem, path.read_text(encoding="utf-8")))
    file_blobs = [(f.filename, await f.read()) for f in files if f.filename]
    job_id = uuid.uuid4().hex
    JOBS[job_id] = asyncio.Queue()
    asyncio.create_task(run_job(job_id, text, example_texts, file_blobs, key=x_openai_key))
    return JSONResponse({"job_id": job_id})


@app.get("/api/events/{job_id}")
async def events(job_id: str) -> StreamingResponse:
    async def stream():
        q = JOBS.get(job_id)
        if q is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'unknown job'})}\n\n"
            return
        try:
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            JOBS.pop(job_id, None)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/finalize")
async def finalize(payload: dict = Body(...), x_openai_key: str = Header(None)) -> JSONResponse:
    apply_key(x_openai_key)
    try:
        result = await finalize_pack(
            payload.get("extract") or {},
            payload.get("plan") or {},
            payload.get("followup") or {},
            (payload.get("decision") or "approved").lower(),
            payload.get("note") or "",
        )
        return JSONResponse(result.model_dump())
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": friendly_error(e)}, status_code=200)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"openai_key": bool(os.getenv("OPENAI_API_KEY"))})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8020, reload=False)
