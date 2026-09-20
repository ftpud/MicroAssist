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

## iPhone app

Open [ios/MicroAssist.xcodeproj](ios/MicroAssist.xcodeproj) in Xcode. The project contains the SwiftUI app, WidgetKit extension, shared App Group cache, Keychain credentials, and the `Send to Assistant` App Intent. It targets iOS 17 or newer.

Before installing on a device:

1. Select your Apple development team for both targets.
2. Change `com.microassist.app` and `com.microassist.app.widget` if those bundle IDs are unavailable.
3. Change `group.com.microassist.shared` consistently in both entitlements files and `SharedConfig.swift`, then enable that App Group for both targets.
4. Ensure both targets have Keychain Sharing enabled with `com.microassist.shared`.
5. Build and run `MicroAssist`, open Settings, and enter the externally reachable HTTPS server URL and bearer token. `127.0.0.1` on an iPhone refers to the phone, not this server.

To create the dictation shortcut, open Shortcuts and make a new shortcut with two actions:

1. `Dictate Text`
2. `Send to Assistant`, with the dictated text passed into its Text parameter

The intent refreshes all widget timelines after the server responds. The widget also refreshes from `/actual.md` approximately every 90 minutes and displays its App Group cache when offline; iOS may delay background refreshes.

Command-line compile check:

```sh
xcodebuild -project ios/MicroAssist.xcodeproj \
  -scheme MicroAssist \
  -sdk iphonesimulator \
  CODE_SIGNING_ALLOWED=NO build
```
