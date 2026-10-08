from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "lernyqo.db"
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_compat_migrations():
    """Apply tiny, idempotent migrations needed when an older Lernyqo DB is reused."""
    with engine.begin() as conn:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(mistakes)"))}
        if "fixed" not in cols:
            conn.execute(text("ALTER TABLE mistakes ADD COLUMN fixed BOOLEAN NOT NULL DEFAULT 0"))
