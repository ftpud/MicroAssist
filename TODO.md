# MicroAssist — implementation roadmap

## Product goal

Keep `ACTUAL.md` as the stable summarized overview, and add a synchronized stack of timely cards above it across the server, iPhone app, and widgets.

A card can contain Markdown, represent the latest assistant response, highlight something urgent, or surface a reminder appropriate to the current time of day. Cards can be dismissed with a swipe without removing the underlying `ACTUAL.md` summary. Reminder cards can also generate notifications at an exact time.

## Guiding rules

- Markdown remains the human-readable source of truth.
- `ACTUAL.md` remains an independently generated summary and is never replaced by cards.
- Cards are a temporary, high-priority layer rendered above the `ACTUAL.md` summary.
- Cards are server-generated and immutable from the user's perspective.
- The server exclusively owns card content, IDs, ordering, urgency, schedules, and dismissal state.
- Users can only read a card or close/dismiss it; there is no card editing flow.
- The app and widget render the same server-generated snapshot containing both cards and `ACTUAL.md`.
- Every card has a stable ID so dismissals synchronize correctly.
- Do not invent urgency, deadlines, or reminders that the user did not request.
- Widget content is read-only; dismissal happens in the app or through a dedicated dismiss action where WidgetKit permits it.
- Cached cards remain visible offline.
- Keep the first version single-user.

## Phase 1 — define the card contract

- [x] Add `CARDS.md` to the server workspace.
- [x] Add card rules and examples to `workspace.example/AGENTS.md`.
- [x] Define the canonical card fields:
  - `id`: stable, unique identifier;
  - `kind`: `actual`, `response`, `reminder`, `morning`, `lunch`, `evening`, or `notice`;
  - `title`: short card title;
  - `bodyMarkdown`: Markdown content;
  - `priority`: integer used for ordering;
  - `createdAt`: ISO-8601 timestamp;
  - `visibleFrom` and `visibleUntil`: optional ISO-8601 timestamps;
  - `notificationAt`: optional ISO-8601 notification time;
  - `dismissible`: whether swipe-to-dismiss is allowed;
  - `kaomoji`: optional decorative character;
  - `source`: task, recurring item, memory, prompt response, or system refresh.
- [x] Define a deterministic, server-owned Markdown representation in `CARDS.md` using one `##` section per card and a fenced YAML metadata block.
- [x] Add TypeScript types and validation for cards.
- [x] Reject malformed cards, duplicate IDs, invalid timezones, and invalid date ranges.
- [ ] Add fixture cards covering every card kind.
- [ ] Document the schema and compatibility/versioning policy.

Acceptance criteria:

- [x] `CARDS.md` remains human-readable for diagnostics, but only the server/Codex workflow writes it.
- [x] No client-facing operation allows a user to edit card title, body, metadata, priority, or schedule.
- [x] The server can parse and serialize `CARDS.md` without losing Markdown content.
- [x] Parse → serialize → parse produces equivalent cards.

## Phase 2 — generate genuinely current cards

- [x] Improve the existing `ACTUAL.md` generation prompt so the summary remains concise, current, and independent of temporary cards.
- [x] Add a separate structured card-generation step after rebuilding `ACTUAL.md`.
- [x] Pass the exact current time and timezone to Codex (weekday and time period are derived in that timezone).
- [x] Require Codex to derive cards only from persistent state, the latest prompt, and explicit reminder state.
- [x] Generate a maximum of 10 active cards.
- [ ] Rank cards using explicit rules:
  1. overdue or immediately due reminders;
  2. tasks scheduled for the current time window;
  3. today’s recurring tasks;
  4. latest useful prompt response;
  5. upcoming tasks;
  6. contextual morning/lunch/evening summaries.
- [x] Remove expired and dismissed content server-side and instruct generation to remove completed and duplicated content.
- [x] Add deterministic server-side filtering after the model turn so expired cards never reach clients.
- [x] Generate cards alongside `ACTUAL.md`; never derive the complete summary only from the temporary card set.
- [x] Allow cards to reference facts already present in `ACTUAL.md` without removing those facts from the summary.
- [ ] Add evaluation fixtures for “what is actually relevant now.”
- [ ] Test timezone changes and daylight-saving transitions.

Acceptance criteria:

- [ ] “Remind me in 5 minutes” is not shown as generally upcoming after it expires.
- [ ] Completed tasks disappear from active cards.
- [ ] No date or obligation appears unless supported by state or the user’s prompt.
- [x] App and widget show the same cards above the same `ACTUAL.md` summary.

## Phase 3 — cards API and synchronization

- [x] Implement `GET /cards` returning versioned JSON with Markdown bodies.
- [x] Implement `GET /snapshot` returning cards and `actualMarkdown` atomically so clients cannot mix generations.
- [x] Add `ETag` and `304 Not Modified` support to `/cards`.
- [x] Include `generatedAt`, timezone, and snapshot version in every response.
- [x] Keep `GET /actual.md` as a compatibility endpoint.
- [x] Return the newly generated/updated cards from `POST /prompt`.
- [x] Add `POST /cards/:id/dismiss`.
- [x] Do not implement `PUT`, `PATCH`, or content-editing endpoints for cards.
- [x] Store dismissal records in `DISMISSED.md` with card ID and timestamp.
- [ ] Define when a dismissed recurring card may reappear, normally at its next recurrence.
- [x] Make dismissal idempotent.
- [ ] Add a “dismiss all expired cards” maintenance pass.
- [ ] Serialize prompt, refresh, reminder, and dismissal mutations through the existing mutex.
- [ ] Add API contract tests, including concurrent refresh/dismiss races.

Acceptance criteria:

- [x] Dismissing a card removes it from subsequent app and widget snapshots.
- [x] Repeating the same dismissal request is safe.
- [x] Two devices receive the same ordered card list.

## Phase 4 — Markdown rendering

- [x] Implement a shared Swift `Card` model matching the server contract.
- [x] Render supported Markdown in the iOS app using native `AttributedString(markdown:)`.
- [ ] Support headings, emphasis, links, inline code, lists, and checkboxes.
- [ ] Sanitize unsupported HTML and unsafe links.
- [x] Create a compact Markdown renderer for WidgetKit.
- [x] Define truncation rules per widget family without breaking Markdown syntax.
- [x] Preserve raw Markdown in the App Group cache.
- [ ] Add rendering snapshots for short, long, malformed, and multilingual Markdown.

Acceptance criteria:

- [ ] The same card remains semantically equivalent in the app and widget.
- [ ] Large Markdown cards do not overflow or crash the widget.
- [ ] Links are tappable in the app and open only allowed URL schemes.

## Phase 5 — iPhone cards above ACTUAL

- [x] Keep the current summarized `ACTUAL.md` section list as the main page content.
- [x] Add a card stack above the `ACTUAL.md` summary.
- [x] Present card content as read-only Markdown with no edit affordance, context-menu edit action, or text field.
- [ ] Show one primary card prominently with the next cards visibly stacked behind it.
- [x] Add horizontal swipe-to-dismiss for dismissible cards.
- [ ] Add spring animation and undo for accidental dismissals.
- [ ] Send dismissal to the server before permanently removing the cached card.
- [ ] Queue a dismissal locally and retry when offline.
- [ ] Add vertical scrolling inside long cards without conflicting with horizontal dismissal.
- [ ] Add card-kind styling while keeping one coherent design system.
- [ ] Show freshness and offline state without covering card content.
- [ ] Add a detail view for full Markdown content.
- [x] Keep the `ACTUAL.md` summary visible after the last card is dismissed.
- [ ] Add accessibility labels, Dynamic Type, VoiceOver actions, and Reduce Motion behavior.

Acceptance criteria:

- [ ] A card can be dismissed smoothly with one swipe.
- [x] The only card mutation available to the user is dismissal.
- [x] A failed dismissal restores the card or clearly marks it pending.
- [x] Relaunching the app shows exactly the cached cards and cached `ACTUAL.md` from one snapshot.
- [x] Dismissing every card reveals the unchanged summarized `ACTUAL.md` underneath.

## Phase 6 — latest response card

- [x] Capture a concise user-facing response from every successful prompt turn.
- [x] Create or replace a `response` card after `POST /prompt`.
- [ ] Give response cards a short lifetime unless they contain lasting information.
- [ ] Never copy internal reasoning, tool output, or implementation details into the card.
- [x] Return the response card directly to `SendToAssistantIntent`.
- [x] Show a useful Shortcut dialog while also updating the card stack.
- [ ] Deduplicate repeated or retried prompts.

Acceptance criteria:

- [ ] The latest prompt response appears as the first card immediately after a successful request.
- [ ] Retrying a network request does not create duplicate response cards.
- [x] Swiping away a response card does not delete the underlying task or memory.

## Phase 7 — reminder parsing and scheduling

- [x] Add `REMINDERS.md` as persistent reminder state.
- [x] Resolve relative reminders such as “in 5 minutes” using the supplied `now` and timezone.
- [ ] Parse absolute reminders such as “tomorrow at 09:30.”
- [ ] Ask for clarification instead of inventing a time when a request is ambiguous.
- [ ] Store the resolved absolute timestamp and original user phrase.
- [ ] Support reminder status: scheduled, delivered, completed, cancelled, and expired.
- [ ] Add `GET /reminders` and cancellation/completion endpoints.
- [x] Add a server scheduler that restores pending reminder cards after restart.
- [ ] Recalculate recurring reminder occurrences safely across daylight-saving changes.
- [ ] Add clock-controlled tests instead of real five-minute waits.

Acceptance criteria:

- [ ] “Remind me in 5 minutes” schedules exactly one reminder five minutes from the server-provided `now`.
- [ ] Restarting the server does not lose scheduled reminders.
- [ ] Cancelled and completed reminders never fire.

## Phase 8 — notification delivery

- [x] Request notification permission in the iOS app.
- [x] Implement local notifications for reminder cards synchronized to the device.
- [x] Add an App Intent result that schedules the local notification immediately after the server resolves the time.
- [x] Register the app for remote notifications.
- [x] Implement `POST /devices/register` and `DELETE /devices/:id`.
- [x] Store the single-user device token in a protected server state file for the POC.
- [x] Add APNs provider authentication using environment-based `.p8` credentials.
- [x] Send an APNs alert when a server-side reminder becomes due.
- [x] Include card/reminder IDs in notification payloads for deep linking.
- [ ] Open the matching card when the notification is tapped.
- [ ] Prevent duplicate local and remote notifications for the same reminder.
- [ ] Handle revoked permissions, rotated device tokens, APNs errors, and offline devices.
- [x] Never place bearer tokens or private task contents in notification metadata.

Acceptance criteria:

- [ ] A five-minute reminder fires when the app is backgrounded.
- [ ] A reminder created outside the phone still reaches the phone through APNs.
- [ ] Tapping the notification opens the matching card.

## Phase 9 — morning, lunch, and evening cards

- [x] Add initial local time windows to the generation contract:
  - morning: 06:00–10:30;
  - lunch: 11:30–14:30;
  - evening: 17:00–22:00.
- [x] Generate at most one active card for each time window.
- [ ] Morning card: today’s priorities, first timed commitment, and overdue items.
- [ ] Lunch card: unfinished morning items and the next useful action.
- [ ] Evening card: remaining urgent items, recurring evening tasks, and tomorrow’s first known item.
- [x] Do not generate an empty or generic motivational card when there is nothing useful to show.
- [x] Expire time-of-day cards at the end of their window.
- [ ] Refresh cards at the beginning and end of every configured window.
- [ ] Optionally notify only when the card contains a genuine reminder or urgent item.
- [ ] Add per-window notification preferences in the app.

Acceptance criteria:

- [ ] A morning card never remains the primary card at night.
- [ ] Lunch and evening cards contain state-backed information, not filler.
- [ ] Changing timezone regenerates the correct time-window card.

## Phase 10 — cheerful kaomoji graphics

- [x] Define a small approved kaomoji set, for example:
  - success: `٩(ˊᗜˋ*)و`;
  - calm: `(◡‿◡)`;
  - reminder: `( •̀ᴗ•́ )و`;
  - morning: `☀︎(˶ᵔ ᵕ ᵔ˶)`;
  - evening: `(－ω－) zzZ`;
  - empty state: `(｡•́‿•̀｡)`.
- [ ] Map kaomoji to card kinds and states deterministically.
- [x] Keep kaomoji decorative and never use them as the only status indicator.
- [ ] Add a user preference: cheerful, subtle, or off.
- [x] Ensure VoiceOver does not read decorative kaomoji as meaningless punctuation.
- [ ] Verify glyph support and layout at all Dynamic Type sizes.
- [ ] Add matching lightweight card colors and animations.
- [ ] Respect Reduce Motion and Increased Contrast settings.

Acceptance criteria:

- [ ] Graphics feel cheerful without obscuring tasks or reminders.
- [ ] Turning graphics off removes them everywhere, including widgets.
- [ ] Cards remain understandable without color, animation, or kaomoji.

## Phase 11 — widget cards above ACTUAL

- [x] Make the small widget show the highest-priority card when one exists, otherwise the first lines of `ACTUAL.md`.
- [x] Make the medium widget show the primary card on top and a compact `ACTUAL.md` summary below it.
- [x] Make the large widget show 2–3 cards on top and the summarized `ACTUAL.md` underneath.
- [x] Make the iOS 27 full-page widget show the active card stack at the top and the complete summarized `ACTUAL.md` below it.
- [ ] Use `AppIntentConfiguration` for widget preferences where appropriate.
- [ ] Add interactive next/previous controls where WidgetKit permits them.
- [ ] Add a `DismissCardIntent` for interactive widget dismissal on supported OS versions.
- [ ] Fall back to opening the app when interactive dismissal is unavailable.
- [ ] Reload only affected widget timelines after prompt, dismissal, or reminder changes.
- [x] Keep the last valid combined card-and-ACTUAL snapshot if network refresh fails.
- [ ] Add widget previews and screenshots for every supported family.

Acceptance criteria:

- [ ] Every widget family displays a useful layout rather than a stretched small widget.
- [x] Widget ordering matches the app ordering.
- [x] Every non-small widget keeps the summarized `ACTUAL.md` visible below its cards.
- [x] The full-page iOS 27 widget is discoverable as a separate gallery option.

## Phase 12 — reliability, privacy, and rollout

- [ ] Add schema migration support for cached cards and server Markdown files.
- [x] Back up `CARDS.md`, `REMINDERS.md`, and `DISMISSED.md` with the workspace.
- [ ] Add structured logs without prompt text, tokens, or private card content.
- [ ] Add rate limits for prompts, dismissals, and device registration.
- [x] Verify bearer authentication on every private endpoint.
- [x] Keep APNs credentials outside the repository and never commit them.
- [ ] Add end-to-end tests with a fake clock and fake APNs provider.
- [ ] Test server restart during a pending reminder.
- [ ] Test offline app launch, queued dismissal, and later reconciliation.
- [ ] Test simultaneous app and widget refreshes.
- [ ] Test Russian and English prompts and Markdown.
- [ ] Add an upgrade guide from the current `ACTUAL.md`-only version.

## Recommended implementation order

1. Card schema and `CARDS.md` parser.
2. `/cards` endpoint and App Group file cache.
3. iPhone card stack above the existing ACTUAL summary, with Markdown rendering.
4. Swipe dismissal and server synchronization.
5. Latest-response cards.
6. Better ACTUAL/card generation and relevance evaluations.
7. Reminder state and exact-time scheduler.
8. Local notifications, followed by APNs delivery.
9. Morning/lunch/evening cards.
10. Kaomoji styling and accessibility.
11. Widget layouts with cards above ACTUAL and interactive widget actions.
12. End-to-end reliability and migration testing.

## Final definition of done

- [ ] A prompt creates a useful Markdown card and updates `ACTUAL.md`; both appear in the app and widget from the same snapshot.
- [ ] The latest response is visible as a dismissible card.
- [ ] Swiping a card removes it everywhere without deleting unrelated state.
- [ ] “Remind me in 5 minutes” produces exactly one on-time notification.
- [ ] Morning, lunch, and evening cards appear only during their configured windows and contain genuinely relevant information.
- [ ] All supported widget sizes, including the iOS 27 full-page widget, show cards above the summarized ACTUAL content rather than replacing it.
- [ ] Offline mode shows cached cards and reconciles safely when connectivity returns.
- [ ] Markdown, accessibility, timezone handling, restart persistence, and notification permissions are covered by automated tests.
