from __future__ import annotations

import json
from urllib.error import URLError
from urllib.request import urlopen

BASE_URL = "http://127.0.0.1:8020"
EXPECTED = {"01_product_launch_sync", "02_incident_review", "03_sales_handoff"}


def get_json(path: str) -> dict | list:
    with urlopen(BASE_URL + path, timeout=5) as res:  # noqa: S310 - local demo URL
        return json.loads(res.read().decode("utf-8"))


def get_text(path: str) -> str:
    with urlopen(BASE_URL + path, timeout=5) as res:  # noqa: S310 - local demo URL
        return res.read().decode("utf-8", errors="replace")


def main() -> int:
    try:
        health = get_json("/api/health")
        examples = set(get_json("/api/examples"))
        html = get_text("/")
    except URLError as exc:
        print(f"ERROR server not reachable: {exc}")
        return 1
    checks = {
        "home_page": "MeetingToAction" in html,
        "openai_key_configured": bool(health.get("openai_key")),
        "examples_present": EXPECTED <= examples,
    }
    for key, ok in checks.items():
        print(f"{'OK' if ok else 'FAIL'} {key}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
