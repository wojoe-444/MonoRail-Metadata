import pytest

from monorail_worker import allowlist
from monorail_worker.config import Settings
from monorail_worker.identity import AuthError, Identity, email_allowed
from monorail_worker.protocol import GoogleAuth, LocalAuth

T = "/tables/0a51e62b-5121-48a5-8aa6-86888b01be67"
U = "7f517ae8-6d8e-446d-83fc-05f88a445bd4"


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/tables"),
        ("GET", T),
        ("GET", "/tables/name/bigquery.acme.marts.orders"),
        ("GET", "/users/name/ada.park"),
        ("GET", "/search/query"),
        ("GET", "/system/version"),
        ("PATCH", T),
        ("PUT", "/tables"),
        ("DELETE", T),
        ("PUT", "/glossaryTerms"),
        ("PATCH", "/dataQuality/testCases/" + U),
        ("POST", "/dataQuality/testCases/testCaseResults/a.b.c"),
        ("PUT", "/services/ingestionPipelines"),
        ("POST", "/services/ingestionPipelines/trigger/" + U),
        ("PUT", "/lineage"),
        ("DELETE", f"/lineage/table/{U}/table/{U}"),
        ("POST", "/feed"),
        ("POST", f"/feed/{U}/posts"),
        ("POST", f"/usage/table/{U}"),
        ("PUT", f"{T}/followers"),
        ("DELETE", f"{T}/followers/{U}"),
        ("PUT", f"/services/databaseServices/{U}/followers"),
        ("PUT", f"{T}/votes"),
        ("PUT", "/dataProducts/revenue/assets/add"),
        ("PUT", "/teams"),
    ],
)
def test_allowed(method, path):
    ok, why = allowlist.check(method, path)
    assert ok, why


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/bots"),
        ("GET", "/bots/name/ingestion-bot"),
        ("GET", "/system/settings"),
        ("GET", "/system/settings/emailConfiguration"),
        ("GET", "/users/token/" + U),
        ("GET", "/users/generateToken/" + U),
        ("GET", "/users/auth-mechanism/" + U),
        ("GET", "/USERS/TOKEN/" + U),
        ("PUT", "/users"),
        ("PATCH", "/users/" + U),
        ("PUT", "/users/generateToken/" + U),
        ("PUT", "/services/databaseServices"),
        ("PATCH", "/services/databaseServices/" + U),
        ("POST", "/bots"),
        ("PUT", "/roles"),
        ("PUT", "/policies"),
        ("PUT", "/system/settings"),
        ("PUT", "/followers"),
        ("PUT", f"/users/{U}/votes/{U}"),
        ("HEAD", T),
        ("TRACE", T),
        ("GET", "/tables/../bots"),
        ("GET", "/tables/%2e%2e/bots"),
        ("GET", "tables"),
        ("GET", "//evil.example/x"),
        ("GET", "http://evil.example/api/v1/tables"),
        ("GET", "/tables?fields=*"),
        ("GET", "/api/v1/tables"),
        ("GET", "/tables\\x"),
        (None, T),
    ],
)
def test_refused(method, path):
    ok, why = allowlist.check(method, path)
    assert not ok and why


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
