import uvicorn

from .config import get_settings

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, proxy_headers=True, forwarded_allow_ips="*")
