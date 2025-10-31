from contextlib import closing

import bcrypt
import db
def old():
    with db._connect() as cursor: 
        cursor.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
                created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
            );

            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            """)
        row = cursor.execute("SELECT COUNT(*) AS c FROM users").fetchone()
        if row["c"] == 0:
            import bcrypt
            def _mk_user(email: str, pw: str, role: str):
                pw_hash = bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
                cursor.execute(
                    """
                    INSERT INTO users (email, password_hash, role, active)
                    VALUES (?, ?, ?, 1)
                    """,
                    (email, pw_hash, role)
                )

            # admin can add/delete/checkout/etc
            _mk_user("rushil@hocc.com", "hocc@1234", "admin")

            # viewer is read-only
            _mk_user("user@hocc.com", "rushil@12", "viewer")
            
            
execute="""

ALTER TABLE checkouts ADD COLUMN max_checkout_time INTEGER;  -- in minutes
ALTER TABLE checkouts ADD COLUMN due_at TEXT;                -- ISO string (UTC)
ALTER TABLE checkouts ADD COLUMN notified_at TEXT;           -- ISO string (UTC), null until emailed

-- Settings table (singleton row id=1)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_email TEXT NOT NULL,
  reminder_freq_minutes INTEGER NOT NULL DEFAULT 180,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default settings if missing
INSERT OR IGNORE INTO settings (id, admin_email, reminder_freq_minutes)
VALUES (1, 'homeofcreativechaos@gmail.com', 180);
        """
       
def executor(executee):
    with db._connect() as cursor: 
        cursor.executescript(executee)
    
#executor(execute)


def reset_users():
    print(" Resetting all users...")
    with closing(db.get_conn()) as conn, conn:
        # 1️⃣  Drop all existing users
        conn.execute("DELETE FROM users;")

        # 2️⃣  Optionally reset auto-increment counter
        conn.execute("DELETE FROM sqlite_sequence WHERE name='users';")

        # 3️⃣  Define your new base users
        seed_users = [
            {
                "email": "admin@hocc.com",
                "password": "12345678",
                "role": "admin",
            },
            {
                "email": "rushil@hocc.com",
                "password": "Bread@1234",
                "role": "admin",
            },
            {
                "email": "user@hocc.com",
                "password": "Rushil@12",
                "role": "user",
            },
        ]

        # 4️⃣  Insert them with bcrypt hashes
        for u in seed_users:
            pw_hash = bcrypt.hashpw(u["password"].encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            conn.execute(
                "INSERT INTO users (email, password_hash, role, active) VALUES (?, ?, ?, 1)",
                (u["email"].lower(), pw_hash, u["role"])
            )
        print(f"✅  Inserted {len(seed_users)} users.")

reset_users()