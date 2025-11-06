"""
Create or update an initial admin user.
Usage:
  python bootstrap_admin.py --email rushil@hocc.com --name "Admin" --password "Hocc@123" 
"""
import argparse
import bcrypt
import db

def upsert_admin(email: str, name: str, password: str, maxcl):
    email = email.lower().strip()
    name = name.strip()
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

    rows = db.db_read("SELECT id, role FROM users WHERE email = ?", (email,))
    if rows:
        uid = rows[0]["id"]
        db.db_write(
            "UPDATE users SET name=?, role='admin', password_hash=?, max_clearance_level=?, updated_at = datetime('now') WHERE id=?",
            (name, pw_hash, maxcl, uid),
        )
        print(f"Updated existing admin: {email} (id={uid})")
    else:
        uid = db.db_write(
            "INSERT INTO users(email, name, role, password_hash, max_clearance_level) VALUES (?, ?, 'admin', ?, ?)",
            (email, name, pw_hash, maxcl),
        )
        print(f"Created admin: {email} (id={uid})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--maxcl", type=int, default=None, help="Leave empty for unlimited")
    args = parser.parse_args()
    upsert_admin(args.email, args.name, args.password, args.maxcl)
