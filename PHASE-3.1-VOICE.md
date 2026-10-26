# Phase 3.1 brief: agents speak with ElevenLabs voices

Product owner, 26 Oct 2026: "I want to connect ElevenLabs; I have an API key. The characters
should talk with a voice." Build after Phase 3 (0.6.x), as 0.7.0. Same rules as always.

## Approach

Not an MCP server: the ElevenLabs MCP is for an agent that wants to make audio files. Here the
**AI Squad server** calls the ElevenLabs text-to-speech REST API directly (`node:` fetch, no
SDK) and the browser plays the audio while the character talks. The browser never sees the key.

## Key handling

- The owner enters the key once in **Settings → Voice** (write-only field) or sets
  `ELEVENLABS_API_KEY` in the service environment. Stored in `~/.aisquad/secrets.json` (0600),
  never in a repo, never in logs, never sent to the browser (the UI only shows "key set" and the
  last 4 characters). A "Test voice" button checks it.

## What speaks

- **Finished** reports and **questions / Waiting for your reply**: the character says a short
  spoken version (headline + up to ~2 sentences, made from the message without a model call;
  the full text stays in the conversation view). In the conversation view, a play button reads
  the whole message on demand.
- The lead's shout when the team is idle, meeting / standup lines (short).
- Language follows the text (Indonesian or English): multilingual model; a low-latency model
  (Flash/Turbo class) by default, configurable.

## Voices

- A voice per agent (Desk → Profile → Voice: pick from the account's voices list fetched from
  the API, preview button), default voices per role so a new squad sounds right immediately.
  Stored in `team.json` as a voice id only.
- The talking animation (portrait and in-office character) follows the audio amplitude
  (Web Audio analyser) so the mouth moves with the words; reduced-motion respected.

## Cost and control

- Cache audio by hash of (voice, model, text) in `~/.aisquad/voice-cache/` with a size cap.
- Monthly character budget per Building (default modest, e.g. 50 000 characters) with a meter
  in Settings; when reached, fall back to the browser's speechSynthesis or silence.
- Mute per Floor, quiet hours, "speak only when the tab is visible", and the existing Voice
  toggle in the dock controls everything. Never speak secrets: run the redaction module first.
- Log `voice.spoken` (characters, voice, cached) so the Audit can show voice cost.

## Later (not in 0.7.0)

- The owner talks back: push-to-talk in the conversation view with speech-to-text, sent as a
  Reply.

## Acceptance

Unit tests (secret storage and never exposing the key, text shortening, cache, budget, fallback),
a mocked ElevenLabs endpoint in tests, one real call only when the owner has set the key and
asks for it. README "Voice", PROGRESS line, version 0.7.0.
