"""Who sent a request (docs/team-backend.md, "Identity"). The worker never trusts a typed name in google mode."""

from __future__ import annotations

from typing import Any, Callable

from .config import Settings
from .protocol import GoogleAuth, LocalAuth


class AuthError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code  # "unauthenticated" | "forbidden"
        super().__init__(message)


TokenVerifier = Callable[[str, str], dict[str, Any]]


def google_verifier() -> TokenVerifier:
    """Verifies a Google ID token's signature, audience, issuer and expiry with google-auth."""
    from google.auth.transport import requests as gat
    from google.oauth2 import id_token

    session = gat.Request()

    def verify(token: str, audience: str) -> dict[str, Any]:
        return id_token.verify_oauth2_token(token, session, audience=audience)

    return verify


def email_allowed(email: str, settings: Settings) -> bool:
    email = email.lower()
    if email in settings.allowed_emails:
        return True
    domain = email.rsplit("@", 1)[-1]
    return domain in settings.allowed_domains


class Identity:
    def __init__(self, settings: Settings, verifier: TokenVerifier | None = None):
        self.settings = settings
        self._verifier = verifier

    def verify(self, auth: GoogleAuth | LocalAuth) -> str:
        """The verified identity (`by`), or AuthError."""
        if isinstance(auth, LocalAuth):
            if self.settings.team_auth != "local":
                raise AuthError("unauthenticated", "Local identities are accepted only when the worker runs with TEAM_AUTH=local.")
            return auth.user
        if not self.settings.google_client_id:
            raise AuthError("unauthenticated", "The worker has no GOOGLE_OAUTH_CLIENT_ID, so it can't verify Google sign-ins.")
        if self._verifier is None:
            self._verifier = google_verifier()
        try:
            claims = self._verifier(auth.idToken, self.settings.google_client_id)
        except Exception as e:  # invalid signature, wrong audience, expired, malformed
            raise AuthError("unauthenticated", f"The Google ID token didn't verify: {e}") from e
        email = str(claims.get("email") or "")
        if not email or not claims.get("email_verified", False):
            raise AuthError("unauthenticated", "The Google ID token has no verified email.")
        if not email_allowed(email, self.settings):
            raise AuthError("forbidden", f"{email} is not on this team's allowlist.")
        return email.lower()
