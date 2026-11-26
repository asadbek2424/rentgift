import uvicorn

from .config import get_settings
from .logs import LOG_CONFIG

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, proxy_headers=True, forwarded_allow_ips="*",
                log_config=LOG_CONFIG)
