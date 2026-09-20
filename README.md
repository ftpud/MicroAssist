# MicroAssist server

Minimal single-user personal-assistant server backed by Markdown and Codex ACP.

## Run locally

Requirements: Node.js 20+, a Codex login or OpenAI API key, and a long random bearer token.

```sh
cp .env.example .env
test -d workspace || cp -R workspace.example workspace
# edit .env, then export its values (Node does not load .env itself)
set -a; source .env; set +a
npm install
npm run build
npm start
```

The process starts one `codex-acp` subprocess and one persistent ACP session rooted at `workspace/`. Set `OPENAI_API_KEY`, or log in with the Codex CLI in the same OS account before starting the service. The Codex account must also be able to write its own `~/.codex` state directory.

```sh
curl http://127.0.0.1:3000/health
curl -H 'Authorization: Bearer YOUR_TOKEN' http://127.0.0.1:3000/actual.md
curl -X POST http://127.0.0.1:3000/prompt \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"text":"Купить хлеб и молоко","timezone":"Europe/Riga"}'
```

`POST /prompt` accepts an optional ISO-8601 `now`; when omitted, the server supplies its current time. Prompt turns, including cron refreshes, share a mutex. `/actual.md` supports `ETag` and `If-None-Match`. `/health` is intentionally unauthenticated for process health checks; content routes require the bearer token.

## Scheduling and persistence

In `TIMEZONE` local time, the server refreshes at 07:00 and every two hours from 09:00 through 21:00. A successful prompt rebuilds `ACTUAL.md` in the same model turn. At 02:30 it copies `workspace/` to `backups/` and retains the latest 14 snapshots.

## Docker

```sh
cp .env.example .env
test -d workspace || cp -R workspace.example workspace
mkdir -p backups
docker compose up -d --build
```

Compose binds only `workspace/` and `backups/` into the container, drops Linux capabilities, and uses a restart policy. Keep the port bound to loopback and put TLS in front of it if the iPhone connects over a network. Never commit `.env` or expose the endpoint without HTTPS.

`workspace/` is intentionally ignored by Git because it contains personal state. `workspace.example/` is the tracked initial template.

## Checks

```sh
npm test
npm run typecheck
npm run build
```
