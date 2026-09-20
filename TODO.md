# MicroAssist — implementation roadmap

## Product goal

Turn the current `ACTUAL.md` summary into a synchronized stack of useful cards across the server, iPhone app, and widgets.

A card can contain Markdown, represent the latest assistant response, highlight something urgent, or surface a reminder appropriate to the current time of day. Cards can be dismissed with a swipe. Reminder cards can also generate notifications at an exact time.

## Guiding rules

- Markdown remains the human-readable source of truth.
- The server owns card IDs, ordering, urgency, schedules, and dismissal state.
- The app and widget render the same server-generated card snapshot.
- Every card has a stable ID so dismissals synchronize correctly.
- Do not invent urgency, deadlines, or reminders that the user did not request.
- The widget is read-only; card dismissal happens in the app or through an App Intent.
- Cached cards remain visible offline.
- Keep the first version single-user.

## Phase 1 — define the card contract

- [ ] Add `CARDS.md` to the server workspace.
- [ ] Add card rules and examples to `workspace.example/AGENTS.md`.
- [ ] Define the canonical card fields:
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
- [ ] Define a deterministic Markdown representation in `CARDS.md` using one `##` section per card and a fenced YAML metadata block.
- [ ] Add TypeScript types and validation for cards.
- [ ] Reject malformed cards, duplicate IDs, invalid timezones, and invalid date ranges.
- [ ] Add fixture cards covering every card kind.
- [ ] Document the schema and compatibility/versioning policy.

Acceptance criteria:

- [ ] A person can read and edit `CARDS.md` without special tooling.
- [ ] The server can parse and serialize `CARDS.md` without losing Markdown content.
- [ ] Parse → serialize → parse produces equivalent cards.

## Phase 2 — generate genuinely current cards

- [ ] Replace the broad “rebuild ACTUAL” prompt with a structured card-generation prompt.
- [ ] Pass the exact current time, timezone, weekday, and local time-of-day period to Codex.
- [ ] Require Codex to derive cards only from `MEMORY.md`, `TASKS.md`, `RECURRING.md`, the latest prompt, and explicit reminder state.
- [ ] Generate a maximum of 10 active cards.
- [ ] Rank cards using explicit rules:
  1. overdue or immediately due reminders;
  2. tasks scheduled for the current time window;
  3. today’s recurring tasks;
  4. latest useful prompt response;
  5. upcoming tasks;
  6. contextual morning/lunch/evening summaries.
- [ ] Remove completed, expired, duplicated, and dismissed content.
- [ ] Add deterministic server-side filtering after the model turn so expired cards never reach clients.
- [ ] Generate `ACTUAL.md` from the validated card set for backwards compatibility.
- [ ] Add evaluation fixtures for “what is actually relevant now.”
- [ ] Test timezone changes and daylight-saving transitions.

Acceptance criteria:

- [ ] “Remind me in 5 minutes” is not shown as generally upcoming after it expires.
- [ ] Completed tasks disappear from active cards.
- [ ] No date or obligation appears unless supported by state or the user’s prompt.
- [ ] App, widget, and `ACTUAL.md` agree on the same active information.

## Phase 3 — cards API and synchronization

- [ ] Implement `GET /cards` returning versioned JSON with Markdown bodies.
- [ ] Add `ETag` and `304 Not Modified` support to `/cards`.
- [ ] Include `generatedAt`, timezone, and snapshot version in every response.
- [ ] Keep `GET /actual.md` as a compatibility endpoint.
- [ ] Return the newly generated/updated cards from `POST /prompt`.
- [ ] Add `POST /cards/:id/dismiss`.
- [ ] Store dismissal records in `DISMISSED.md` with card ID and timestamp.
- [ ] Define when a dismissed recurring card may reappear, normally at its next recurrence.
- [ ] Make dismissal idempotent.
- [ ] Add a “dismiss all expired cards” maintenance pass.
- [ ] Serialize prompt, refresh, reminder, and dismissal mutations through the existing mutex.
- [ ] Add API contract tests, including concurrent refresh/dismiss races.

Acceptance criteria:

- [ ] Dismissing a card removes it from subsequent app and widget snapshots.
- [ ] Repeating the same dismissal request is safe.
- [ ] Two devices receive the same ordered card list.

## Phase 4 — Markdown rendering

- [ ] Implement a shared Swift `Card` model matching the server contract.
- [ ] Render supported Markdown in the iOS app using native `AttributedString(markdown:)`.
- [ ] Support headings, emphasis, links, inline code, lists, and checkboxes.
- [ ] Sanitize unsupported HTML and unsafe links.
- [ ] Create a compact Markdown renderer for WidgetKit.
- [ ] Define truncation rules per widget family without breaking Markdown syntax.
- [ ] Preserve raw Markdown in the App Group cache.
- [ ] Add rendering snapshots for short, long, malformed, and multilingual Markdown.

Acceptance criteria:

- [ ] The same card remains semantically equivalent in the app and widget.
- [ ] Large Markdown cards do not overflow or crash the widget.
- [ ] Links are tappable in the app and open only allowed URL schemes.

## Phase 5 — iPhone card stack

- [ ] Replace the current section list with a card-stack screen.
- [ ] Show one primary card prominently with the next cards visibly stacked behind it.
- [ ] Add horizontal swipe-to-dismiss for dismissible cards.
- [ ] Add spring animation and undo for accidental dismissals.
- [ ] Send dismissal to the server before permanently removing the cached card.
- [ ] Queue a dismissal locally and retry when offline.
- [ ] Add vertical scrolling inside long cards without conflicting with horizontal dismissal.
- [ ] Add card-kind styling while keeping one coherent design system.
- [ ] Show freshness and offline state without covering card content.
- [ ] Add a detail view for full Markdown content.
- [ ] Add accessibility labels, Dynamic Type, VoiceOver actions, and Reduce Motion behavior.

Acceptance criteria:

- [ ] A card can be dismissed smoothly with one swipe.
- [ ] A failed dismissal restores the card or clearly marks it pending.
- [ ] Relaunching the app shows exactly the cached server snapshot.

## Phase 6 — latest response card

- [ ] Capture a concise user-facing response from every successful prompt turn.
- [ ] Create or replace a `response` card after `POST /prompt`.
- [ ] Give response cards a short lifetime unless they contain lasting information.
- [ ] Never copy internal reasoning, tool output, or implementation details into the card.
- [ ] Return the response card directly to `SendToAssistantIntent`.
- [ ] Show a useful Shortcut dialog while also updating the card stack.
- [ ] Deduplicate repeated or retried prompts.

Acceptance criteria:

- [ ] The latest prompt response appears as the first card immediately after a successful request.
- [ ] Retrying a network request does not create duplicate response cards.
- [ ] Swiping away a response card does not delete the underlying task or memory.

## Phase 7 — reminder parsing and scheduling

- [ ] Add `REMINDERS.md` with stable IDs and explicit lifecycle states.
- [ ] Parse relative reminders such as “in 5 minutes” using the supplied `now` and timezone.
- [ ] Parse absolute reminders such as “tomorrow at 09:30.”
- [ ] Ask for clarification instead of inventing a time when a request is ambiguous.
- [ ] Store the resolved absolute timestamp and original user phrase.
- [ ] Support reminder status: scheduled, delivered, completed, cancelled, and expired.
- [ ] Add `GET /reminders` and cancellation/completion endpoints.
- [ ] Add a server scheduler that restores pending reminders after restart.
- [ ] Recalculate recurring reminder occurrences safely across daylight-saving changes.
- [ ] Add clock-controlled tests instead of real five-minute waits.

Acceptance criteria:

- [ ] “Remind me in 5 minutes” schedules exactly one reminder five minutes from the server-provided `now`.
- [ ] Restarting the server does not lose scheduled reminders.
- [ ] Cancelled and completed reminders never fire.

## Phase 8 — notification delivery

- [ ] Request notification permission in the iOS app with a clear explanation.
- [ ] Implement local notifications for reminders created on the same device.
- [ ] Add an App Intent result that schedules the local notification immediately after the server resolves the time.
- [ ] Register the app for remote notifications.
- [ ] Implement `POST /devices/register` and `DELETE /devices/:id`.
- [ ] Store the single-user device token in a protected server state file for the POC.
- [ ] Add APNs provider authentication using environment-based `.p8` credentials.
- [ ] Send an APNs alert when a server-side reminder becomes due.
- [ ] Include card/reminder IDs in notification payloads for deep linking.
- [ ] Open the matching card when the notification is tapped.
- [ ] Prevent duplicate local and remote notifications for the same reminder.
- [ ] Handle revoked permissions, rotated device tokens, APNs errors, and offline devices.
- [ ] Never place bearer tokens or private task contents in notification metadata.

Acceptance criteria:

- [ ] A five-minute reminder fires when the app is backgrounded.
- [ ] A reminder created outside the phone still reaches the phone through APNs.
- [ ] Tapping the notification opens the matching card.

## Phase 9 — morning, lunch, and evening cards

- [ ] Add configurable local time windows, initially:
  - morning: 06:00–10:30;
  - lunch: 11:30–14:30;
  - evening: 17:00–22:00.
- [ ] Generate at most one active card for each time window.
- [ ] Morning card: today’s priorities, first timed commitment, and overdue items.
- [ ] Lunch card: unfinished morning items and the next useful action.
- [ ] Evening card: remaining urgent items, recurring evening tasks, and tomorrow’s first known item.
- [ ] Do not generate an empty or generic motivational card when there is nothing useful to show.
- [ ] Expire time-of-day cards at the end of their window.
- [ ] Refresh cards at the beginning and end of every configured window.
- [ ] Optionally notify only when the card contains a genuine reminder or urgent item.
- [ ] Add per-window notification preferences in the app.

Acceptance criteria:

- [ ] A morning card never remains the primary card at night.
- [ ] Lunch and evening cards contain state-backed information, not filler.
- [ ] Changing timezone regenerates the correct time-window card.

## Phase 10 — cheerful kaomoji graphics

- [ ] Define a small approved kaomoji set, for example:
  - success: `٩(ˊᗜˋ*)و`;
  - calm: `(◡‿◡)`;
  - reminder: `( •̀ᴗ•́ )و`;
  - morning: `☀︎(˶ᵔ ᵕ ᵔ˶)`;
  - evening: `(－ω－) zzZ`;
  - empty state: `(｡•́‿•̀｡)`.
- [ ] Map kaomoji to card kinds and states deterministically.
- [ ] Keep kaomoji decorative and never use them as the only status indicator.
- [ ] Add a user preference: cheerful, subtle, or off.
- [ ] Ensure VoiceOver does not read decorative kaomoji as meaningless punctuation.
- [ ] Verify glyph support and layout at all Dynamic Type sizes.
- [ ] Add matching lightweight card colors and animations.
- [ ] Respect Reduce Motion and Increased Contrast settings.

Acceptance criteria:

- [ ] Graphics feel cheerful without obscuring tasks or reminders.
- [ ] Turning graphics off removes them everywhere, including widgets.
- [ ] Cards remain understandable without color, animation, or kaomoji.

## Phase 11 — widget card stacks

- [ ] Make small widget show the single highest-priority card.
- [ ] Make medium widget show the primary card plus a visible next-card preview.
- [ ] Make large widget show 3–5 cards.
- [ ] Make the iOS 27 full-page widget show the complete active stack.
- [ ] Use `AppIntentConfiguration` for widget preferences where appropriate.
- [ ] Add interactive next/previous controls where WidgetKit permits them.
- [ ] Add a `DismissCardIntent` for interactive widget dismissal on supported OS versions.
- [ ] Fall back to opening the app when interactive dismissal is unavailable.
- [ ] Reload only affected widget timelines after prompt, dismissal, or reminder changes.
- [ ] Keep the last valid card snapshot if network refresh fails.
- [ ] Add widget previews and screenshots for every supported family.

Acceptance criteria:

- [ ] Every widget family displays a useful layout rather than a stretched small widget.
- [ ] Widget ordering matches the app ordering.
- [ ] The full-page iOS 27 widget is discoverable as a separate gallery option.

## Phase 12 — reliability, privacy, and rollout

- [ ] Add schema migration support for cached cards and server Markdown files.
- [ ] Back up `CARDS.md`, `REMINDERS.md`, and `DISMISSED.md` with the workspace.
- [ ] Add structured logs without prompt text, tokens, or private card content.
- [ ] Add rate limits for prompts, dismissals, and device registration.
- [ ] Verify bearer authentication on every private endpoint.
- [ ] Encrypt APNs credentials and never commit them.
- [ ] Add end-to-end tests with a fake clock and fake APNs provider.
- [ ] Test server restart during a pending reminder.
- [ ] Test offline app launch, queued dismissal, and later reconciliation.
- [ ] Test simultaneous app and widget refreshes.
- [ ] Test Russian and English prompts and Markdown.
- [ ] Add an upgrade guide from the current `ACTUAL.md`-only version.

## Recommended implementation order

1. Card schema and `CARDS.md` parser.
2. `/cards` endpoint and App Group file cache.
3. iPhone card-stack UI and Markdown rendering.
4. Swipe dismissal and server synchronization.
5. Latest-response cards.
6. Better ACTUAL/card generation and relevance evaluations.
7. Reminder state and exact-time scheduler.
8. Local notifications, followed by APNs delivery.
9. Morning/lunch/evening cards.
10. Kaomoji styling and accessibility.
11. Widget layouts and interactive widget actions.
12. End-to-end reliability and migration testing.

## Final definition of done

- [ ] A prompt creates a useful Markdown card and it appears in the app and widget from the same snapshot.
- [ ] The latest response is visible as a dismissible card.
- [ ] Swiping a card removes it everywhere without deleting unrelated state.
- [ ] “Remind me in 5 minutes” produces exactly one on-time notification.
- [ ] Morning, lunch, and evening cards appear only during their configured windows and contain genuinely relevant information.
- [ ] All supported widget sizes, including the iOS 27 full-page widget, show purpose-built card layouts.
- [ ] Offline mode shows cached cards and reconciles safely when connectivity returns.
- [ ] Markdown, accessibility, timezone handling, restart persistence, and notification permissions are covered by automated tests.
