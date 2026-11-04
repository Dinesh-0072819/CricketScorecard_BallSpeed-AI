"""
User accounts and per-user ball-speed history (SQLite, same file as the scorecard).

Tables
  users       id, username (unique, case-insensitive), password_hash, created_at
  speed_runs  id, user_id, speed, status, source, delivery_type, created_at
and a user_id column is added to `matches` so each user sees only their matches.
Passwords are stored as salted hashes (werkzeug / scrypt or pbkdf2), never in plain text.
"""
import re
import sqlite3

from werkzeug.security import check_password_hash, generate_password_hash

from database.scorecard_db import DB_PATH, init_scorecard_db

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_user_db():
    init_scorecard_db()
    c = _conn()
    cur = c.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS speed_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            speed REAL NOT NULL,
            status TEXT,
            source TEXT,
            delivery_type TEXT,
            created_at TIMESTAMP DEFAULT (datetime('now', 'localtime'))
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_speed_runs_user ON speed_runs(user_id, id)")
    cols = [r["name"] for r in cur.execute("PRAGMA table_info(matches)").fetchall()]
    if "user_id" not in cols:
        cur.execute("ALTER TABLE matches ADD COLUMN user_id INTEGER")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id, id)")
    c.commit()
    c.close()


# ------------------------------------------------------------------ accounts
def create_user(username: str, password: str, _allow_guest_name: bool = False):
    """Returns (user_dict, error)."""
    username = (username or "").strip()
    if not USERNAME_RE.match(username):
        return None, "Username must be 3-30 characters: letters, numbers, _ . -"
    if username.lower().startswith("guest_") and not _allow_guest_name:
        return None, "Usernames starting with 'guest_' are reserved"
    if len(password or "") < 6:
        return None, "Password must be at least 6 characters"
    c = _conn()
    try:
        cur = c.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)",
                        (username, generate_password_hash(password)))
        c.commit()
        return {"id": cur.lastrowid, "username": username}, None
    except sqlite3.IntegrityError:
        return None, "That username is already taken"
    finally:
        c.close()


def create_guest_user():
    """A guest account with a random id (e.g. guest_4f9a2c) and a random password nobody knows.
    The guest keeps their matches and speed history while their login session lasts."""
    import secrets
    for _ in range(5):
        name = f"guest_{secrets.token_hex(3)}"
        user, err = create_user(name, secrets.token_urlsafe(24), _allow_guest_name=True)
        if user:
            user["is_guest"] = True
            return user
    return None


def verify_user(username: str, password: str):
    c = _conn()
    row = c.execute("SELECT id, username, password_hash FROM users WHERE username = ?",
                    ((username or "").strip(),)).fetchone()
    c.close()
    if row and check_password_hash(row["password_hash"], password or ""):
        return {"id": row["id"], "username": row["username"]}
    return None


def get_user(user_id):
    if not user_id:
        return None
    c = _conn()
    row = c.execute("SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    c.close()
    return dict(row) if row else None


# ------------------------------------------------------------------ speed history
def add_speed_run(user_id, speed, status, source="video", delivery_type=None):
    c = _conn()
    cur = c.execute(
        "INSERT INTO speed_runs (user_id, speed, status, source, delivery_type) VALUES (?, ?, ?, ?, ?)",
        (user_id, float(speed), status, source, delivery_type))
    c.commit()
    rid = cur.lastrowid
    c.close()
    return rid


def get_speed_runs(user_id, limit=200):
    c = _conn()
    rows = c.execute(
        "SELECT id, speed, status, source, delivery_type, created_at AS timestamp "
        "FROM speed_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?", (user_id, limit)).fetchall()
    c.close()
    return [dict(r) for r in rows]


# ------------------------------------------------------------------ match ownership
def set_match_owner(match_id, user_id):
    c = _conn()
    c.execute("UPDATE matches SET user_id = ? WHERE id = ?", (user_id, match_id))
    c.commit()
    c.close()


def match_owned_by(match_id, user_id) -> bool:
    c = _conn()
    row = c.execute("SELECT 1 FROM matches WHERE id = ? AND user_id = ?", (match_id, user_id)).fetchone()
    c.close()
    return row is not None


def get_user_matches(user_id):
    c = _conn()
    rows = c.execute("SELECT * FROM matches WHERE user_id = ? ORDER BY id DESC", (user_id,)).fetchall()
    c.close()
    return [dict(r) for r in rows]


def get_latest_live_match_id(user_id):
    c = _conn()
    row = c.execute("SELECT id FROM matches WHERE user_id = ? AND status = 'LIVE' ORDER BY id DESC LIMIT 1",
                    (user_id,)).fetchone()
    c.close()
    return row["id"] if row else None


def clear_user_matches(user_id):
    c = _conn()
    ids = [r["id"] for r in c.execute("SELECT id FROM matches WHERE user_id = ?", (user_id,)).fetchall()]
    for mid in ids:
        for t in ("ball_by_ball", "batting_scorecard", "bowling_scorecard"):
            c.execute(f"DELETE FROM {t} WHERE match_id = ?", (mid,))
        c.execute("DELETE FROM matches WHERE id = ?", (mid,))
    c.commit()
    c.close()
    return len(ids)
