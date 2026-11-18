"""Google Cloud Storage as the bucket, through google-cloud-storage.

- Atomic writes: GCS replaces objects whole.
- Create-if-absent: `if_generation_match=0`.
- Compare-and-swap: `if_generation_match=<generation>`.
- Listing: `list_blobs(prefix=…, start_offset=…)`, which GCS returns in key order.

The worker's service account needs objectAdmin on the bucket. Credentials come from Application
Default Credentials (the Vertex AI job's service account, or `gcloud auth application-default login`).
"""

from __future__ import annotations

from typing import Any, Iterator

from google.api_core import exceptions as gexc

from .base import ABSENT, Obj

# Objects apps poll must never be served from a cache.
_NO_CACHE = "no-store"


class GcsStorage:
    def __init__(self, client: Any, bucket: str, prefix: str = ""):
        self.client = client
        self.bucket_name = bucket
        self.bucket = client.bucket(bucket)
        self.prefix = prefix.strip("/")
        self.label = f"gs://{bucket}/{self.prefix}" if self.prefix else f"gs://{bucket}"

    @staticmethod
    def from_url(url: str, client: Any | None = None) -> "GcsStorage":
        rest = url.removeprefix("gs://")
        bucket, _, prefix = rest.partition("/")
        if not bucket:
            raise ValueError(f"Bad bucket URL: {url!r}")
        if client is None:
            from google.cloud import storage

            client = storage.Client()
        return GcsStorage(client, bucket, prefix)

    def _name(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def _key(self, name: str) -> str:
        return name[len(self.prefix) + 1 :] if self.prefix else name

    def read(self, key: str) -> tuple[bytes, str] | None:
        for _ in range(5):
            blob = self.bucket.get_blob(self._name(key))
            if blob is None:
                return None
            try:
                data = blob.download_as_bytes(if_generation_match=blob.generation)
                return data, str(blob.generation)
            except gexc.NotFound:
                return None
            except gexc.PreconditionFailed:
                continue  # replaced between the metadata read and the download
        blob = self.bucket.get_blob(self._name(key))
        if blob is None:
            return None
        return blob.download_as_bytes(), str(blob.generation)

    def _upload(self, key: str, data: bytes, content_type: str, **kw: Any) -> str:
        blob = self.bucket.blob(self._name(key))
        blob.cache_control = _NO_CACHE
        blob.upload_from_string(data, content_type=content_type, **kw)
        return str(blob.generation)

    def write(self, key: str, data: bytes, content_type: str = "application/json") -> str:
        return self._upload(key, data, content_type)

    def create(self, key: str, data: bytes, content_type: str = "application/json") -> bool:
        try:
            self._upload(key, data, content_type, if_generation_match=0)
            return True
        except gexc.PreconditionFailed:
            return False

    def cas(self, key: str, data: bytes, generation: str, content_type: str = "application/json") -> str | None:
        gen = 0 if generation == ABSENT else int(generation)
        try:
            return self._upload(key, data, content_type, if_generation_match=gen)
        except gexc.PreconditionFailed:
            return None

    def list(self, prefix: str, start_offset: str | None = None) -> Iterator[Obj]:
        kw: dict[str, Any] = {"prefix": self._name(prefix)}
        if start_offset:
            kw["start_offset"] = self._name(start_offset)
        for b in self.client.list_blobs(self.bucket_name, **kw):
            updated = b.updated.timestamp() * 1000 if b.updated is not None else 0
            yield Obj(self._key(b.name), str(b.generation), int(updated), int(b.size or 0))

    def delete(self, key: str) -> None:
        try:
            self.bucket.blob(self._name(key)).delete()
        except gexc.NotFound:
            pass
