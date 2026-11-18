"""A local folder as the bucket (one machine, for development).

- Atomic writes: a temp file in the same folder, then a rename.
- Create-if-absent: a temp file hard-linked into place (the link fails if the name exists), so a
  reader never sees a half-written file. Falls back to an exclusive create where links don't work.
- Compare-and-swap: an exclusive lock file around read-compare-write. A generation is a hash of
  the file's bytes.
"""

from __future__ import annotations

import errno
import hashlib
import os
import time
from pathlib import Path
from typing import Iterator

from .base import ABSENT, Obj

_RETRIES = 40


def _gen(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:20]


def _hidden(name: str) -> bool:
    return name.startswith(".") or name.endswith(".tmp") or name.endswith(".lock")


class LocalStorage:
    def __init__(self, root: str | os.PathLike[str]):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.label = str(self.root)

    # ---- paths ----
    def _path(self, key: str) -> Path:
        # No resolve(): on Windows it follows hard links to whichever name the OS picks.
        parts = key.split("/")
        if not key or key.startswith("/") or "\\" in key or ":" in key or any(s in ("", ".", "..") for s in parts):
            raise ValueError(f"Bad key: {key!r}")
        return self.root.joinpath(*parts)

    def _tmp(self, p: Path) -> Path:
        return p.with_name(f".{p.name}.{os.getpid()}.{os.urandom(4).hex()}.tmp")

    # ---- interface ----
    def read(self, key: str) -> tuple[bytes, str] | None:
        p = self._path(key)
        for i in range(_RETRIES):
            try:
                data = p.read_bytes()
                return data, _gen(data)
            except FileNotFoundError:
                return None
            except PermissionError:
                # Windows: the file is being replaced right now.
                time.sleep(0.005 * (i + 1))
        data = p.read_bytes()
        return data, _gen(data)

    def write(self, key: str, data: bytes, content_type: str = "application/json") -> str:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._tmp(p)
        tmp.write_bytes(data)
        try:
            for i in range(_RETRIES):
                try:
                    os.replace(tmp, p)
                    return _gen(data)
                except PermissionError:
                    # Windows: a reader has the target open without delete sharing. Try again.
                    time.sleep(0.005 * (i + 1))
            os.replace(tmp, p)
            return _gen(data)
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    def create(self, key: str, data: bytes, content_type: str = "application/json") -> bool:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._tmp(p)
        tmp.write_bytes(data)
        try:
            os.link(tmp, p)
            return True
        except FileExistsError:
            return False
        except OSError as e:
            if e.errno not in (errno.EPERM, errno.ENOTSUP, errno.EXDEV, errno.EINVAL):
                raise
            # No hard links here: exclusive create (a reader could see a partial file briefly).
            try:
                with open(p, "xb") as f:
                    f.write(data)
                return True
            except FileExistsError:
                return False
        finally:
            tmp.unlink(missing_ok=True)

    def cas(self, key: str, data: bytes, generation: str, content_type: str = "application/json") -> str | None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        lock = p.with_name(p.name + ".lock")
        self._lock(lock)
        try:
            cur = self.read(key)
            cur_gen = ABSENT if cur is None else cur[1]
            if cur_gen != generation:
                return None
            return self.write(key, data, content_type)
        finally:
            lock.unlink(missing_ok=True)

    def _lock(self, lock: Path, stale_s: float = 10.0, wait_s: float = 5.0) -> None:
        deadline = time.monotonic() + wait_s
        while True:
            try:
                fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, f"{os.getpid()}".encode())
                os.close(fd)
                return
            except FileExistsError:
                try:
                    if time.time() - lock.stat().st_mtime > stale_s:
                        lock.unlink(missing_ok=True)  # left behind by a crashed process
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() > deadline:
                    raise TimeoutError(f"Lock {lock} is held")
                time.sleep(0.005)
            except PermissionError:
                # Windows: the lock file is being deleted right now.
                time.sleep(0.005)

    def list(self, prefix: str, start_offset: str | None = None) -> Iterator[Obj]:
        base_key = prefix.rsplit("/", 1)[0] if "/" in prefix else ""
        base = self.root / base_key if base_key else self.root
        if not base.is_dir():
            return iter(())
        out: list[Obj] = []
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            rel_dir = Path(dirpath).relative_to(self.root).as_posix()
            for name in filenames:
                if _hidden(name):
                    continue
                key = name if rel_dir == "." else f"{rel_dir}/{name}"
                if not key.startswith(prefix) or (start_offset and key < start_offset):
                    continue
                try:
                    st = os.stat(os.path.join(dirpath, name))
                except FileNotFoundError:
                    continue
                out.append(Obj(key, "", int(st.st_mtime * 1000), st.st_size))
        out.sort(key=lambda o: o.key)
        return iter(out)

    def delete(self, key: str) -> None:
        p = self._path(key)
        for i in range(_RETRIES):
            try:
                p.unlink(missing_ok=True)
                return
            except PermissionError:
                time.sleep(0.005 * (i + 1))
