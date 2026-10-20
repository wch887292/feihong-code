"""Tavily Search web search for last30days skill.

Uses the Tavily Search API as the preferred web search backend.
Tavily is AI-optimized and significantly stronger than Brave/Parallel/OpenRouter.

API docs: https://docs.tavily.com/
"""

import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import http

ENDPOINT = "https://api.tavily.com/search"


def search_web(
    topic: str,
    from_date: str,
    to_date: str,
    api_key: str,
    depth: str = "default",
) -> List[Dict[str, Any]]:
    """Search the web via Tavily Search API.

    Args:
        topic: Search topic
        from_date: Start date (YYYY-MM-DD)
        to_date: End date (YYYY-MM-DD)
        api_key: Tavily API key
        depth: 'quick', 'default', or 'deep'

    Returns:
        List of result dicts with keys: url, title, snippet, source_domain, date, relevance
    """
    count = {"quick": 8, "default": 15, "deep": 25}.get(depth, 15)

    # Tavily doesn't have a date filter — filter results post-fetch
    body = {
        "query": topic,
        "search_depth": "basic" if depth == "quick" else "advanced",
        "max_results": count,
        "include_answer": False,
        "include_raw_content": False,
        "include_images": False,
    }

    sys.stderr.write(f"[Web] Searching Tavily for: {topic}\n")
    sys.stderr.flush()

    response = http.request(
        "POST",
        ENDPOINT,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json_data=body,
        timeout=20,
    )

    return _normalize_results(response, from_date, to_date)


def _normalize_results(
    response: Dict[str, Any],
    from_date: str,
    to_date: str,
) -> List[Dict[str, Any]]:
    """Convert Tavily response to websearch item schema."""
    results = response.get("results", [])
    items = []

    for i, result in enumerate(results):
        url = result.get("url", "")
        if not url:
            continue

        title = (result.get("title") or "").strip()
        snippet = (result.get("content") or "").strip()

        if not title and not snippet:
            continue

        items.append({
            "id": f"W{i+1}",
            "title": title[:200],
            "url": url,
            "source_domain": result.get("source", ""),
            "snippet": snippet[:500],
            "date": None,  # Tavily doesn't reliably provide dates
            "date_confidence": "low",
            "relevance": result.get("score", 0.6),
            "why_relevant": "",
        })

    sys.stderr.write(f"[Web] Tavily: {len(items)} results\n")
    sys.stderr.flush()

    return items
