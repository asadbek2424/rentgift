import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
_db = Path(tempfile.mkdtemp()) / "test.db"
os.environ.update({
    "DATABASE_URL": f"sqlite+aiosqlite:///{_db}", "DEMO_MODE": "true", "RUN_BOT": "false", "BOT_TOKEN": "123:TEST",
    "ADMIN_IDS": "1", "RATE_MODE": "manual", "MANUAL_RATE_UZS_PER_TON": "40000", "MARKUP_PERCENT": "15",
    "CARD_NUMBER": "8600 0000 0000 0000", "DEV_USER_ID": "0", "USE_RENT_EVENTS": "false",
    "BACKUP_INTERVAL_HOURS": "0", "SERVICE_FEE_UZS": "1800", "MIN_RENT_DAYS": "3", "UZS_ROUND_TO": "10",
})
