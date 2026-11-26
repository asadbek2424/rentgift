"""Logging setup: everything to stdout (Railway shows stderr lines as errors), noisy libraries quieted."""
import logging
import sys

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"

# httpx logs every request at INFO (the rent-event feed alone is ~6 lines a minute);
# telethon logs "Got difference for channel ..." for every channel the userbot account is in.
QUIET = ("httpx", "httpcore", "telethon", "aiogram.event")

LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"default": {"format": FORMAT}},
    "handlers": {"stdout": {"class": "logging.StreamHandler", "formatter": "default", "stream": "ext://sys.stdout"}},
    "root": {"level": "INFO", "handlers": ["stdout"]},
    "loggers": {
        "uvicorn": {"level": "INFO", "handlers": [], "propagate": True},
        "uvicorn.error": {"level": "INFO", "handlers": [], "propagate": True},
        "uvicorn.access": {"level": "WARNING", "handlers": [], "propagate": True},
        **{name: {"level": "WARNING"} for name in QUIET},
    },
}


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=FORMAT, stream=sys.stdout, force=True)
    for name in QUIET:
        logging.getLogger(name).setLevel(logging.WARNING)
