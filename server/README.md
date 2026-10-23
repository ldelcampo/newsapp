# News server

Fetches the shipped free news feeds every 15 minutes and serves them to the app. It never sees anyone's topics, mail or calendar: the app downloads articles and ranks them locally.

## Run locally

```sh
npm run server:dev        # builds and starts on http://localhost:8787
```

## Deploy

```sh
cd server && docker compose up -d --build
```

It listens on `127.0.0.1:8787`; put a reverse proxy with HTTPS in front of it.

## API

- `GET /health` → `{ ok, lastRefresh, articles }`
- `GET /api/sources` → shipped sources with their last fetch status
- `GET /api/articles?lang=en,es&since=<ISO time>` → `{ lastRefresh, articles: Article[] }`, newest first, last 72 hours
