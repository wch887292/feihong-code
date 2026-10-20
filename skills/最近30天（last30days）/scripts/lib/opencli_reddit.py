"""OpenCLI-based Reddit discovery (no OpenAI key required).

Uses the local `opencli reddit search` adapter, which drives a real browser
session and returns posts with real engagement metrics (score, comments).
This is a drop-in replacement for openai_reddit.search_reddit + parse_reddit_response
for environments without an OpenAI API key (e.g. no US billing).

The returned items match the schema produced by openai_reddit.parse_reddit_response,
so downstream enrichment / ranking is unchanged. `date` is left null here; the
main pipeline's reddit_enrich step backfills the real created date from reddit.com.
"""

import json
import shutil
import subprocess
import sys
from typing import Any, Dict, List

from . import openai_reddit  # reuse _extract_core_subject

DEPTH_LIMITS = {"quick": 15, "default": 25, "deep": 40}


def _log(msg: str):
    sys.stderr.write(f"[REDDIT/opencli] {msg}\n")
    sys.stderr.flush()


def is_available() -> bool:
    """True if the opencli binary is on PATH."""
    return shutil.which("opencli") is not None


def _days_to_time_filter(days: int) -> str:
    """Map a look-back window in days to opencli's --time bucket."""
    if days <= 1:
        return "day"
    if days <= 7:
        return "week"
    if days <= 31:
        return "month"
    if days <= 366:
        return "year"
    return "all"


def _run_search(query: str, limit: int, time_filter: str, subreddit: str = "") -> List[Dict[str, Any]]:
    """Run one `opencli reddit search` and return its raw rows."""
    cmd = [
        "opencli", "reddit", "search", query,
        "--sort", "relevance",
        "--time", time_filter,
        "--limit", str(limit),
        "-f", "json",
        "--window", "background",
    ]
    if subreddit:
        cmd += ["--subreddit", subreddit]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        _log(f"search failed ({type(e).__name__}) for query={query!r}")
        return []

    if proc.returncode != 0:
        _log(f"non-zero exit ({proc.returncode}) for query={query!r}: {proc.stderr.strip()[:200]}")
        # opencli may still have emitted valid JSON before a SIGPIPE-like exit
    out = proc.stdout.strip()
    if not out:
        return []
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        _log(f"could not parse JSON for query={query!r}")
        return []

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("rows") or data.get("results") or data.get("data") or []
    return []


def _to_item(row: Dict[str, Any], idx: int) -> Dict[str, Any]:
    """Convert an opencli reddit row to the parse_reddit_response item schema."""
    url = str(row.get("url", "")).strip()
    subreddit = str(row.get("subreddit", "")).strip()
    # opencli returns "r/Name" — normalize to "Name"
    while subreddit.lower().startswith("r/"):
        subreddit = subreddit[2:]

    score = row.get("score")
    comments = row.get("comments")

    return {
        "id": f"R{idx + 1}",
        "title": str(row.get("title", "")).strip(),
        "url": url,
        "subreddit": subreddit,
        "date": None,  # backfilled by reddit_enrich from reddit.com JSON
        "why_relevant": "",
        "relevance": 0.6,
        # Pre-populated engagement from opencli; reddit_enrich refines if reachable
        "score": int(score) if isinstance(score, (int, float)) else None,
        "num_comments": int(comments) if isinstance(comments, (int, float)) else None,
        "author": str(row.get("author", "")).strip() or None,
    }


def search_reddit(topic: str, from_date: str, to_date: str, days: int, depth: str = "default") -> List[Dict[str, Any]]:
    """Discover Reddit threads about `topic` via opencli (no OpenAI key needed).

    Args:
        topic: Search topic (raw user query)
        from_date: Start date YYYY-MM-DD (unused for query; server filters by --time)
        to_date: End date YYYY-MM-DD (unused for query)
        days: Look-back window in days (mapped to opencli --time bucket)
        depth: 'quick' | 'default' | 'deep'

    Returns:
        List of item dicts matching openai_reddit.parse_reddit_response schema.
    """
    limit = DEPTH_LIMITS.get(depth, 25)
    time_filter = _days_to_time_filter(days)
    core = openai_reddit._extract_core_subject(topic)

    rows: List[Dict[str, Any]] = []
    seen_urls = set()

    # Pass 1: core-subject relevance search across all of Reddit
    for row in _run_search(core, limit, time_filter):
        url = str(row.get("url", "")).strip()
        if not url or "reddit.com" not in url or "/comments/" not in url:
            continue
        if url in seen_urls:
            continue
        seen_urls.add(url)
        rows.append(row)

    # Pass 2: if thin, retry with the full topic phrase
    if len(rows) < 5 and core.lower() != topic.lower():
        for row in _run_search(topic, limit, time_filter):
            url = str(row.get("url", "")).strip()
            if not url or "reddit.com" not in url or "/comments/" not in url:
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            rows.append(row)

    items = [_to_item(r, i) for i, r in enumerate(rows)]
    _log(f"found {len(items)} threads (time={time_filter}, depth={depth})")
    return items
