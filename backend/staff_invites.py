"""Staff email invitation system (Zaproszenia pracowników).

Flow:
- Admin sends an invitation from Zespół → Pracownik (one-time token, valid 7 days).
- Employee receives an email with an [AKTYWUJ KONTO] link.
- The link opens a backend-served activation page where the employee sets their own password.
- Token is single-use: consumed on successful activation.

Security:
- Raw token is never stored — only its SHA-256 hash (`token_hash`).
- Tokens are generated with `secrets.token_urlsafe(32)`.
- Password is stored as bcrypt hash (handled by server.py's hash_pw).
"""
from __future__ import annotations

import hashlib
import secrets
from html import escape

INVITE_VALID_DAYS = 7


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


# ---------------------------------------------------------------------------
# Invitation e-mail
# ---------------------------------------------------------------------------

INVITE_SUBJECT = "Zaproszenie do Biesiada pod Lasem 2.0"

_INVITE_TEXT = """Dzień dobry{name_part},

otrzymujesz zaproszenie do aplikacji Biesiada pod Lasem 2.0.

Kliknij poniższy link, aby aktywować konto i ustawić swoje hasło:

{url}

Link jest ważny przez {days} dni i można go użyć tylko raz.

Po aktywacji będziesz mógł zalogować się do aplikacji swoim adresem e-mail i ustawionym hasłem.

Biesiada pod Lasem
"""

_INVITE_HTML = """\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f3;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
      <tr><td style="background:#1f4d2e;padding:22px 28px">
        <span style="color:#ffffff;font-size:19px;font-weight:bold">🌲 Biesiada pod Lasem</span>
      </td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 14px;color:#1c2b21;font-size:15px">Dzień dobry{name_part},</p>
        <p style="margin:0 0 14px;color:#1c2b21;font-size:15px;line-height:1.55">
          otrzymujesz zaproszenie do aplikacji <strong>Biesiada pod Lasem&nbsp;2.0</strong>.
        </p>
        <p style="margin:0 0 22px;color:#1c2b21;font-size:15px;line-height:1.55">
          Kliknij poniższy przycisk, aby aktywować konto i ustawić swoje hasło:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px">
          <tr><td style="background:#2e7d46;border-radius:10px">
            <a href="{url}" style="display:inline-block;padding:14px 34px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">AKTYWUJ KONTO</a>
          </td></tr>
        </table>
        <p style="margin:0 0 14px;color:#5b6b60;font-size:13px;line-height:1.55">
          Link jest ważny przez <strong>{days} dni</strong> i można go użyć tylko raz.<br>
          Po aktywacji zalogujesz się do aplikacji swoim adresem e-mail i ustawionym hasłem.
        </p>
        <p style="margin:22px 0 0;color:#1c2b21;font-size:14px">Biesiada pod Lasem</p>
      </td></tr>
      <tr><td style="background:#f0f3ee;padding:14px 28px">
        <p style="margin:0;color:#8a988e;font-size:11px">
          Wiadomość wysłana przez aplikację Biesiada pod Lasem 2.0. Nigdy nie prosimy o podanie hasła w odpowiedzi na e-mail.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
"""


def build_invite_email(name: str, url: str, days: int = INVITE_VALID_DAYS):
    """Return (subject, body_text, body_html) for the invitation e-mail."""
    name_part = f" {escape(name.strip())}" if (name or "").strip() else ""
    text = _INVITE_TEXT.format(name_part=name_part, url=url, days=days)
    html = _INVITE_HTML.format(name_part=name_part, url=escape(url, quote=True), days=days)
    return INVITE_SUBJECT, text, html


# ---------------------------------------------------------------------------
# Activation page (served by the backend at GET /api/invitations/{token}/activate)
# ---------------------------------------------------------------------------

_PAGE_SHELL = """\
<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aktywacja konta · Biesiada pod Lasem</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         background: linear-gradient(160deg, #16351f 0%, #1f4d2e 55%, #275c38 100%);
         min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #ffffff; border-radius: 18px; width: 100%; max-width: 420px;
          padding: 32px 28px; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
  .brand { text-align: center; font-size: 22px; font-weight: 800; color: #1f4d2e; margin-bottom: 4px; }
  .sub { text-align: center; color: #7a887e; font-size: 13px; margin-bottom: 24px; }
  h1 { font-size: 18px; color: #1c2b21; margin-bottom: 6px; text-align: center; }
  .who { text-align: center; color: #44554a; font-size: 14px; margin-bottom: 20px; }
  .who strong { color: #1f4d2e; }
  label { display: block; font-size: 12px; font-weight: 700; color: #5b6b60; margin: 14px 0 6px; letter-spacing: .4px; }
  input { width: 100%; padding: 13px 14px; border: 1.5px solid #d7ded8; border-radius: 10px;
          font-size: 15px; color: #1c2b21; outline: none; }
  input:focus { border-color: #2e7d46; }
  button { width: 100%; margin-top: 22px; padding: 15px; background: #2e7d46; color: #fff;
           border: 0; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  .msg { display: none; margin-top: 14px; padding: 12px 14px; border-radius: 10px; font-size: 13px; }
  .msg.err { background: #fdecec; color: #9b1c1c; }
  .state { text-align: center; padding: 8px 0 4px; }
  .state .icon { font-size: 42px; margin-bottom: 12px; }
  .state p { color: #44554a; font-size: 14px; line-height: 1.6; }
  .hint { margin-top: 18px; text-align: center; color: #8a988e; font-size: 12px; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">🌲 Biesiada pod Lasem</div>
    <div class="sub">Aplikacja 2.0 · Aktywacja konta pracownika</div>
    __CONTENT__
  </div>
</body>
</html>
"""

_FORM_CONTENT = """\
    <div id="form-panel">
      <h1>Ustaw swoje hasło</h1>
      <p class="who">Konto: <strong>__EMAIL__</strong></p>
      <label>HASŁO (min. 6 znaków)</label>
      <input id="pw1" type="password" autocomplete="new-password" placeholder="Nowe hasło">
      <label>POWTÓRZ HASŁO</label>
      <input id="pw2" type="password" autocomplete="new-password" placeholder="Powtórz hasło">
      <div id="err" class="msg err"></div>
      <button id="btn" onclick="activate()">Aktywuj konto</button>
      <p class="hint">Link jest jednorazowy. Po aktywacji zalogujesz się w aplikacji adresem e-mail i ustawionym hasłem.</p>
    </div>
    <div id="ok-panel" style="display:none">
      <div class="state">
        <div class="icon">🎉</div>
        <h1>Konto aktywne!</h1>
        <p>Możesz teraz zalogować się w aplikacji <strong>Biesiada pod Lasem 2.0</strong><br>
           adresem <strong>__EMAIL__</strong> i ustawionym hasłem.</p>
      </div>
    </div>
    <script>
      async function activate() {
        var pw1 = document.getElementById('pw1').value;
        var pw2 = document.getElementById('pw2').value;
        var err = document.getElementById('err');
        var btn = document.getElementById('btn');
        err.style.display = 'none';
        if (!pw1 || pw1.length < 6) { err.textContent = 'Hasło musi mieć min. 6 znaków.'; err.style.display = 'block'; return; }
        if (pw1 !== pw2) { err.textContent = 'Hasła nie są identyczne.'; err.style.display = 'block'; return; }
        btn.disabled = true; btn.textContent = 'Aktywuję…';
        try {
          var res = await fetch(window.location.pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw1 })
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(data.detail || 'Nie udało się aktywować konta.');
          document.getElementById('form-panel').style.display = 'none';
          document.getElementById('ok-panel').style.display = 'block';
        } catch (e) {
          err.textContent = e.message || 'Błąd sieci. Spróbuj ponownie.';
          err.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Aktywuj konto';
        }
      }
    </script>
"""

_STATE_CONTENT = {
    "invalid": ("🔒", "Zaproszenie jest nieważne",
                "Ten link aktywacyjny nie istnieje lub został już unieważniony.<br>Poproś administratora o nowe zaproszenie."),
    "expired": ("⏰", "Zaproszenie wygasło",
                "Ten link był ważny przez 7 dni i stracił ważność.<br>Poproś administratora o ponowne wysłanie zaproszenia."),
    "used": ("✅", "Konto zostało już aktywowane",
             "To zaproszenie zostało już wykorzystane.<br>Zaloguj się w aplikacji Biesiada pod Lasem 2.0 swoim adresem e-mail i hasłem."),
    "cancelled": ("🚫", "Zaproszenie anulowane",
                  "To zaproszenie zostało anulowane przez administratora.<br>Poproś o nowe zaproszenie."),
}


def render_activation_page(state: str, email: str = "") -> str:
    """Render the activation HTML page. state ∈ {form, invalid, expired, used, cancelled}."""
    if state == "form":
        content = _FORM_CONTENT.replace("__EMAIL__", escape(email or ""))
    else:
        icon, title, text = _STATE_CONTENT.get(state, _STATE_CONTENT["invalid"])
        content = (
            '<div class="state">'
            f'<div class="icon">{icon}</div>'
            f'<h1>{title}</h1>'
            f'<p>{text}</p>'
            '</div>'
        )
    return _PAGE_SHELL.replace("__CONTENT__", content)


def invitation_page_state(inv: dict | None, now_iso: str) -> str:
    """Map an invitation document to an activation-page state."""
    if not inv:
        return "invalid"
    status = inv.get("status")
    if status == "accepted":
        return "used"
    if status == "cancelled":
        return "cancelled"
    if (inv.get("expires_at") or "") < now_iso:
        return "expired"
    return "form"
