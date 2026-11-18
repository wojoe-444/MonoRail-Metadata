"""The bucket interface: a local folder and GCS behave the same (docs/team-backend.md, "Bucket layout")."""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from typing import Any, Iterator, Protocol

# The generation of an object that doesn't exist. `cas(key, data, ABSENT)` is create-if-absent.
ABSENT = "0"


@dataclass(frozen=True)
class Obj:
    key: str
    generation: str
    updated_ms: int
    size: int


class Storage(Protocol):
    label: str

    def read(self, key: str) -> tuple[bytes, str] | None:
        """The object's bytes and generation, or None if it doesn't exist."""

    def write(self, key: str, data: bytes, content_type: str = "application/json") -> str:
        """Replace the object atomically. Returns the new generation."""

    def create(self, key: str, data: bytes, content_type: str = "application/json") -> bool:
        """Create the object only if nothing is there. False if it already existed."""

    def cas(self, key: str, data: bytes, generation: str, content_type: str = "application/json") -> str | None:
        """Write only if the object's generation is still `generation` (ABSENT: doesn't exist).
        Returns the new generation, or None if someone else changed it first."""

    def list(self, prefix: str, start_offset: str | None = None) -> Iterator[Obj]:
        """Objects whose key starts with `prefix`, in key order, from `start_offset` (inclusive)."""

    def delete(self, key: str) -> None:
        """Delete the object; no error if it's already gone."""


def dumps(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def read_json(storage: Storage, key: str) -> Any | None:
    got = storage.read(key)
    if got is None:
        return None
    raw = gzip.decompress(got[0]) if key.endswith(".gz") else got[0]
    return json.loads(raw.decode("utf-8"))


def write_json(storage: Storage, key: str, value: Any) -> str:
    if key.endswith(".gz"):
        # mtime=0 keeps the bytes stable for identical content.
        return storage.write(key, gzip.compress(dumps(value), mtime=0), "application/gzip")
    return storage.write(key, dumps(value))


def open_storage(spec: str) -> Storage:
    if spec.startswith("gs://"):
        from .gcs import GcsStorage

        return GcsStorage.from_url(spec)
    from .local import LocalStorage

    return LocalStorage(spec.removeprefix("file://"))
