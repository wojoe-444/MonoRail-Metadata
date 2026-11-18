"""The worker's OpenMetadata client: the only client of OpenMetadata in team mode.

Signs in like server/om/client.ts: a bot JWT (OM_TOKEN), or a basic-auth login with the password
base64-encoded (POST /api/v1/auth/login), retried once on a 401.
"""

from __future__ import annotations

import base64
import json
import re
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Mapping, Protocol

import httpx

log = logging.getLogger(__name__)

NO_BODY: Any = object()


@dataclass
class OmResponse:
    status: int
    body: Any


class OmError(Exception):
    def __init__(self, status: int, body: Any, what: str = ""):
        self.status = status
        self.body = body
        text = body if isinstance(body, str) else json.dumps(body)[:300]
        super().__init__(f"OpenMetadata answered {status}{' for ' + what if what else ''}: {text[:300]}")


class Om(Protocol):
    url: str

    def request(
        self,
        method: str,
        path: str,
        query: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        body: Any = NO_BODY,
    ) -> OmResponse: ...


def get_json(om: Om, path: str, query: Mapping[str, Any] | None = None) -> Any:
    res = om.request("GET", path, query)
    if res.status >= 400:
        raise OmError(res.status, res.body, f"GET {path}")
    return res.body


def try_get(om: Om, path: str, query: Mapping[str, Any] | None = None) -> Any | None:
    """GET, or None on a 404."""
    res = om.request("GET", path, query)
    if res.status == 404:
        return None
    if res.status >= 400:
        raise OmError(res.status, res.body, f"GET {path}")
    return res.body


class OmClient:
    def __init__(self, url: str, token: str = "", email: str = "", password: str = "", timeout: float = 60.0):
        if not url:
            raise ValueError("OM_URL is not set: the worker needs a real OpenMetadata.")
        self.url = url.rstrip("/")
        # On Windows, "localhost" tries ::1 first and Docker's port only answers on IPv4, which
        # costs seconds per new connection. Talk to 127.0.0.1 instead (self.url stays as configured).
        self._base = re.sub(r"^(https?://)localhost(?=[:/]|$)", r"\g<1>127.0.0.1", self.url)
        self._token = token
        self._email = email
        self._password = password
        self._login: tuple[str, float] | None = None
        self._lock = threading.Lock()
        self.http = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self.http.close()

    def _access_token(self) -> str:
        if self._token:
            return self._token
        if not self._email:
            return ""
        with self._lock:
            if self._login and self._login[1] > time.time() + 60:
                return self._login[0]
            res = self.http.post(
                f"{self._base}/api/v1/auth/login",
                json={"email": self._email, "password": base64.b64encode(self._password.encode()).decode()},
            )
            if res.status_code >= 400:
                raise OmError(res.status_code, res.text, f"login as {self._email}")
            body = res.json()
            exp = body.get("expiryDuration")
            # Epoch ms in current releases; small values are seconds.
            expires = time.time() + 30 * 60 if not exp else exp / 1000 if exp > 1e12 else time.time() + exp
            self._login = (body["accessToken"], expires)
            return self._login[0]

    def request(
        self,
        method: str,
        path: str,
        query: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        body: Any = NO_BODY,
    ) -> OmResponse:
        if not path.startswith("/"):
            path = "/" + path
        hdrs: dict[str, str] = {"Accept": "application/json"}
        content: bytes | None = None
        if body is not NO_BODY:
            ctype = (headers or {}).get("Content-Type") or (headers or {}).get("content-type") or "application/json"
            hdrs["Content-Type"] = ctype
            if isinstance(body, str) and not ctype.startswith("application/json") and "json" not in ctype:
                content = body.encode("utf-8")  # text/plain (e.g. CSV import) goes as-is
            else:
                content = json.dumps(body).encode("utf-8")
        params = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in (query or {}).items()}

        def send() -> httpx.Response:
            token = self._access_token()
            h = dict(hdrs)
            if token:
                h["Authorization"] = f"Bearer {token}"
            return self.http.request(method, f"{self._base}/api/v1{path}", params=params, headers=h, content=content)

        res = send()
        if res.status_code == 401 and not self._token and self._email:
            self._login = None
            res = send()
        text = res.text
        parsed: Any = text
        if text and "json" in res.headers.get("content-type", ""):
            try:
                parsed = json.loads(text)
            except ValueError:
                pass
        elif not text:
            parsed = None
        return OmResponse(res.status_code, parsed)
