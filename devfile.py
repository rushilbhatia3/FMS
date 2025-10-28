import db
with db._connect() as cursor:
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('operator','viewer')),
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

        # operator can add/delete/checkout/etc
        _mk_user("rushil@hocc.com", "hocc@1234", "operator")

        # viewer is read-only
        _mk_user("user@hocc.com", "rushil@12", "viewer")