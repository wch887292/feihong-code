"""Zhihu (知乎) discovery via OpenCLI (real browser, beats Zhihu's anti-scraping).

Zhihu has strong anti-scraping, so we drive the logged-in browser through the
local `opencli zhihu` adapter rather than hitting any API. Two capabilities:

  1. hot()       — 知乎热榜 (rank / title / heat / answers / url)
  2. search()    — keyword-relevant answers sorted by votes (the core ask:
                   "关键词相关的热门帖子和高赞回答")

`search` already returns answer-level rows with vote counts, so it directly
surfaces high-vote content. For the top hits we optionally pull full answer
text via `question` to enrich the snippet.
"""

import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from typing import Any, Dict, List

# Soft-ad / marketing signals common in Zhihu search results. Zhihu's JSON does
# not expose the "广告" badge, so we detect promotional answers heuristically:
# titles stuffed with product-roundup / buy-recommendation phrasing, often from
# accounts that flood the results.
_AD_TITLE_PATTERNS = [
    "产品榜单", "最新产品", "值得买", "避坑指南", "推荐榜", "测评", "种草",
    "优惠", "福利", "限时", "下单", "购买链接", "报名", "扫码", "私信我",
    "全网最低", "性价比之王", "闭眼入", "无脑买",
]
# How many times an author must appear in results to be treated as a spam/flood
# account (their hits get down-weighted, not removed outright).
_FLOOD_AUTHOR_THRESHOLD = 3


def _looks_like_ad(title: str) -> bool:
    t = title or ""
    return any(p in t for p in _AD_TITLE_PATTERNS)


def _log(msg: str):
    sys.stderr.write(f"[ZHIHU/opencli] {msg}\n")
    sys.stderr.flush()


def is_available() -> bool:
    return shutil.which("opencli") is not None


def _run(args: List[str], timeout: int = 120) -> List[Dict[str, Any]]:
    """Run an `opencli zhihu …` subcommand, return parsed rows."""
    cmd = ["opencli", "zhihu", *args, "-f", "json", "--window", "background"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        _log(f"{args[0]} failed ({type(e).__name__})")
        return []
    out = proc.stdout.strip()
    if not out:
        if proc.returncode != 0:
            _log(f"{args[0]} exit={proc.returncode}: {proc.stderr.strip()[:160]}")
        return []
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        _log(f"{args[0]} JSON parse failed")
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("rows") or data.get("results") or data.get("data") or []
    return []


def hot(limit: int = 20) -> List[Dict[str, Any]]:
    """知乎热榜. Returns rows with rank/title/heat/answers/url."""
    rows = _run(["hot", "--limit", str(limit)])
    _log(f"hot: {len(rows)} items")
    return rows


def _question_id(url: str) -> str:
    """Extract the question id from a Zhihu answer/question URL."""
    m = re.search(r"/question/(\d+)", url or "")
    return m.group(1) if m else ""


def search(topic: str, limit: int = 12, enrich_top: int = 2) -> List[Dict[str, Any]]:
    """Keyword search on Zhihu, answers sorted by votes.

    Args:
        topic: search query (raw)
        limit: number of answer rows to return
        enrich_top: pull full answer text for the top N highest-vote hits

    Returns:
        List of dicts: title/author/votes/url/content(optional)
    """
    rows = _run(["search", topic, "--limit", str(limit)])
    if not rows:
        # Zhihu browser session can occasionally drop a request when a tab is
        # contended — one retry clears it.
        rows = _run(["search", topic, "--limit", str(limit)])
    if not rows:
        _log("search: 0 results")
        return []

    # Count author frequency to spot flood/spam accounts.
    author_counts = Counter(
        str(r.get("author", "")).strip() for r in rows if r.get("author")
    )

    items: List[Dict[str, Any]] = []
    dropped_ads = 0
    for r in rows:
        url = str(r.get("url", "")).strip()
        if not url:
            continue
        title = str(r.get("title", "")).strip()
        author = str(r.get("author", "")).strip()
        votes = r.get("votes")
        votes = int(votes) if isinstance(votes, (int, float)) else 0

        is_ad_title = _looks_like_ad(title)
        is_flood = author and author_counts.get(author, 0) >= _FLOOD_AUTHOR_THRESHOLD
        # Drop only when BOTH signals fire (marketing title AND flooding account)
        # — that combination is almost always a soft ad. A single signal just
        # down-weights, so we don't lose a genuinely high-vote answer.
        if is_ad_title and is_flood:
            dropped_ads += 1
            continue

        quality = votes
        if is_ad_title or is_flood:
            quality = int(votes * 0.4)  # down-weight suspected promo

        items.append({
            "title": title,
            "author": author or None,
            "votes": votes,
            "quality": quality,
            "url": url,
            "type": str(r.get("type", "")).strip(),
            "content": "",
            "suspected_ad": is_ad_title or is_flood,
        })

    # Sort by quality (vote count adjusted for promo down-weighting), so genuine
    # high-vote answers from quality contributors float to the top.
    items.sort(key=lambda x: x["quality"], reverse=True)
    if dropped_ads:
        _log(f"filtered {dropped_ads} suspected ad(s)")

    # Enrich top hits with full answer text (high-vote content the user wants)
    for it in items[:enrich_top]:
        qid = _question_id(it["url"])
        if not qid:
            continue
        answers = _run(["question", qid, "--limit", "3"])
        if answers:
            top = max(answers, key=lambda a: a.get("votes", 0) or 0)
            it["content"] = str(top.get("content", "")).strip()[:600]

    _log(f"search: {len(items)} answers (enriched top {min(enrich_top, len(items))})")
    return items
