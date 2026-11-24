FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY locales ./locales
COPY webapp ./webapp
COPY tools ./tools
RUN mkdir -p /app/data && useradd -r -u 1000 giftrent && chown -R giftrent /app/data
USER giftrent
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8080'))"
CMD ["python", "-m", "app"]
