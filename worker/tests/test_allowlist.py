import json
import shutil
import subprocess
from pathlib import Path

import pytest

from monorail_worker import allowlist
from monorail_worker.config import Settings
from monorail_worker.identity import AuthError, Identity, email_allowed
from monorail_worker.protocol import GoogleAuth, LocalAuth

CASES_FILE = Path(__file__).with_name("allowlist_cases.json")
CASES = json.loads(CASES_FILE.read_text(encoding="utf-8"))
REPO = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("case", CASES, ids=[f"{c['method']} {c['path']!r}"[:80] for c in CASES])
def test_cases(case):
    ok, why = allowlist.check(case["method"], case["path"])
    assert ok == case["allowed"], why
    assert bool(why) != ok


def _tsx() -> list[str] | None:
    node = shutil.which("node")
    cli = REPO / "node_modules" / "tsx" / "dist" / "cli.mjs"
    return [node, str(cli)] if node and cli.exists() else None


@pytest.mark.skipif(_tsx() is None, reason="node and the repo's node_modules (tsx) are needed to run the app's copy")
def test_app_copy_matches_worker():
    """server/team/allowlist.ts gives the same answer and the same message for every case."""
    out = subprocess.run(
        [*_tsx(), "scripts/allowlist-parity.ts", str(CASES_FILE)], cwd=REPO, capture_output=True, text=True, encoding="utf-8", timeout=120
    )
    assert out.returncode == 0, out.stderr
    app = json.loads(out.stdout)
    assert len(app) == len(CASES)
    for case, (ok, why) in zip(CASES, app):
        assert [ok, why] == list(allowlist.check(case["method"], case["path"])), case


def test_rules_come_from_the_shared_file():
    assert "/bots" in allowlist.GET_DENY and "tables" in allowlist.WRITE_COLLECTIONS
    assert allowlist.PASS_HEADERS == {"content-type"}


def test_normalize():
    assert allowlist.normalize("/tables//x/") == "/tables/x"
    assert allowlist.normalize("/a/../b") is None


def _settings(**kw):
    return Settings(team_bucket="x", **kw)


def test_email_allowlist():
    s = _settings(allowed_domains=["acme.com"], allowed_emails=["contractor@gmail.com"])
    assert email_allowed("Ada@Acme.com", s)
    assert email_allowed("contractor@gmail.com", s)
    assert not email_allowed("ada@acme.com.evil.io", s)
    assert not email_allowed("someone@gmail.com", s)
    assert not email_allowed("ada@sub.acme.com", s)


def test_empty_allowlist_refuses_everyone():
    assert not email_allowed("ada@acme.com", _settings())


def test_local_identity():
    assert Identity(_settings(team_auth="local")).verify(LocalAuth(kind="local", user="ada.park")) == "ada.park"
    with pytest.raises(AuthError) as e:
        Identity(_settings(team_auth="google", google_client_id="cid")).verify(LocalAuth(kind="local", user="ada"))
    assert e.value.code == "unauthenticated"


def test_google_identity_with_fake_verifier():
    seen = {}

    def verifier(token, audience):
        seen["aud"] = audience
        if token == "bad":
            raise ValueError("Token expired")
        return {"email": f"{token}", "email_verified": token != "unverified@acme.com"}

    ident = Identity(_settings(team_auth="google", google_client_id="cid.apps", allowed_domains=["acme.com"]), verifier)
    assert ident.verify(GoogleAuth(kind="google", idToken="Ada@acme.com")) == "ada@acme.com"
    assert seen["aud"] == "cid.apps"
    for token, code in [("bad", "unauthenticated"), ("unverified@acme.com", "unauthenticated"), ("eve@other.com", "forbidden")]:
        with pytest.raises(AuthError) as e:
            ident.verify(GoogleAuth(kind="google", idToken=token))
        assert e.value.code == code


def test_google_identity_without_client_id():
    with pytest.raises(AuthError):
        Identity(_settings(team_auth="google"), lambda t, a: {}).verify(GoogleAuth(kind="google", idToken="x"))
