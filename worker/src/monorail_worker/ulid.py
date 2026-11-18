"""ULIDs: 48-bit millisecond time + 80 random bits, Crockford base32, so names sort by time.

Same format the app writes (server/team/queue.ts).
"""

from __future__ import annotations

import os
import re
import time

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def now_ms() -> int:
    return int(time.time() * 1000)


def encode_time(ms: int) -> str:
    out = ""
    t = max(0, int(ms))
    for _ in range(10):
        out = CROCKFORD[t % 32] + out
        t //= 32
    return out


def new_ulid(ms: int | None = None) -> str:
    rand = os.urandom(16)
    return encode_time(now_ms() if ms is None else ms) + "".join(CROCKFORD[b % 32] for b in rand)


def is_ulid(s: str) -> bool:
    return bool(ULID_RE.match(s))


def ulid_time(s: str) -> int:
    """The millisecond timestamp in a ULID (its first 10 characters)."""
    t = 0
    for ch in s[:10]:
        t = t * 32 + CROCKFORD.index(ch)
    return t


def floor_ulid(ms: int) -> str:
    """The smallest ULID at time `ms`: a start offset for listing ids from that time."""
    return encode_time(ms) + "0" * 16
