"""Which `om` requests the worker will make (docs/team-backend.md, "Allowlist")."""

from __future__ import annotations

from urllib.parse import unquote

WRITE_METHODS = {"PUT", "POST", "PATCH", "DELETE"}
METHODS = WRITE_METHODS | {"GET"}

# GET is allowed on everything except these (and anything under them).
GET_DENY = ("/bots", "/system/settings", "/users/generateToken", "/users/token", "/users/auth-mechanism")

# Writes are allowed on these collections and anything under them.
WRITE_COLLECTIONS = (
    "tables",
    "databases",
    "databaseSchemas",
    "glossaries",
    "glossaryTerms",
    "classifications",
    "tags",
    "domains",
    "dataProducts",
    "metrics",
    "queries",
    "teams",
    "dataQuality",
    "services/ingestionPipelines",
    "lineage",
    "feed",
    "usage",
)
# ...and on these sub-resources of any entity: /{collection}/{id}/followers[/{userId}], /{collection}/{id}/votes.
WRITE_SUBRESOURCES = ("followers", "votes")


def normalize(path: str) -> str | None:
    """A clean `/a/b` path, or None if it tries anything odd (traversal, a full URL, a query)."""
    if not isinstance(path, str) or not path.startswith("/") or "?" in path or "#" in path or "\\" in path:
        return None
    if "://" in path or path.startswith("//"):
        return None
    segs = path.split("/")[1:]
    if any(unquote(s) in (".", "..") for s in segs):
        return None
    if path.startswith("/api/"):
        return None  # paths are relative to /api/v1
    return "/" + "/".join(s for s in segs if s != "")


def _under(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def check(method: str | None, path: str | None) -> tuple[bool, str]:
    """(allowed, reason)."""
    if not method or method not in METHODS:
        return False, f"Method {method!r} is not allowed."
    norm = normalize(path or "")
    if norm is None:
        return False, f"Path {path!r} is not a plain OpenMetadata path."
    low = norm.lower()
    if method == "GET":
        for deny in GET_DENY:
            if _under(low, deny.lower()):
                return False, f"GET {deny} is not available through the team backend."
        return True, ""
    for coll in WRITE_COLLECTIONS:
        if _under(norm, "/" + coll):
            return True, ""
    segs = norm.split("/")[1:]
    # /{collection...}/{id}/followers[/{userId}] or /{collection...}/{id}/votes
    for i, s in enumerate(segs):
        if s in WRITE_SUBRESOURCES and i >= 2 and len(segs) - i <= 2:
            if s == "votes" and len(segs) - i != 1:
                continue
            return True, ""
    return False, f"{method} {norm} is not allowed through the team backend."
