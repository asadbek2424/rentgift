# --- 1) build the React admin panel (served by the bot at /admin/) -------------------------
FROM node:20-alpine AS admin
WORKDIR /panel
COPY admin-panel/package.json admin-panel/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin-panel/ ./
# no VITE_API_URL: the panel talks to the same server it is served from
RUN npm run build

# --- 2) the bot + Mini App -----------------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY locales ./locales
COPY webapp ./webapp
COPY tools ./tools
COPY --from=admin /panel/dist ./admin_dist
RUN mkdir -p /app/data && useradd -r -u 1000 giftrent && chown -R giftrent /app/data
USER giftrent
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8080'))"
CMD ["python", "-m", "app"]
