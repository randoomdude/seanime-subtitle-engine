# Changelog

## 1.1.7 — 2026-09-30

- Detect movie playback and omit season/episode parameters for movie searches. Add a Movie/Series selector for manual searches and hide episode fields in Movie mode.
- Manual searches use only their current fields, without borrowing a prior playback ID, season, or episode.
- Clear playback mapping fields on navigation and ignore obsolete mapping responses before applying IDs.
- Add an optional Wyzie backup preference, enabled by default. Retry once at `sub.wyzie.ru` for a connection failure or HTTP 500–599, preserving the same key and search parameters.
- Do not retry authentication, quota, client errors, empty results, or malformed HTTP 200 responses. Show a backup-server label when it answers.
- Retain native subtitle loading, safe result labels, Spanish variants, and Auto Select None.
- Keep the manifest author field short enough for Seanime's validation; full maintainer and upstream attribution remains in the README.
- Add regression coverage for movie detection, manual field isolation, retry eligibility/limit, disabled backup, and obsolete requests.

Inspired by [José Martins's fork](https://github.com/jose-l-martins/seanime-subtitle-engine), with a separate outage-only retry implementation. Both Wyzie hosts accepted a personal free key and returned Spanish results in the live test. Spanish player playback remains pending user confirmation.

## 1.1.6 — 2026-09-30

- Normalize subtitle result titles, media labels, languages, and formats. Wyzie AI entries can omit release names; label these as AI translations instead of passing null to Seanime's text component.
- Omit missing flag images.
- Clear subtitle results, search errors, selection state, and the search cache when changing shows, videos, or sources.
- Clear Jimaku results before a search so an empty response cannot reuse an older provider's subtitles.
- Ignore obsolete Wyzie and Jimaku responses after the playback/search context changes.
- Use language-filtered results for automatic Wyzie selection.
- Add regression fixtures for null-title rendering, empty Jimaku searches, and a late Wyzie response after navigation.

This corrects the `TypeError: text is required` popup observed in the local 1.1.5 test and stale result reuse when switching to Jimaku. The user subsequently demonstrated Jimaku subtitle playback; Spanish playback verification remains pending.

## 1.1.5 — 2026-09-30 — local test

- Replace the invalid bundled Wyzie key with a **Wyzie API Key** preference.
- Replace obsolete Wyzie provider identifiers with `source=all`, which queries the sources available to the supplied key.
- Display missing-key, authentication, quota, and unexpected-response errors. Clear stale results when starting a Wyzie search.
- Add **Spanish (all variants)** for `es`, `es-*`, `ea`, and `spa`, plus the existing AnimeTosho Latin American Spanish mapping.
- Allow manual searches without an active playback session.
- Preserve the native subtitle compatibility workaround from 1.1.4.

The initial local test cleared the upstream manifest URL to prevent overwriting local changes. The published fork uses its own manifest URL. Version 1.1.5 exposed the missing-title and stale-result issues corrected in 1.1.6.

## 1.1.4 — 2026-08-29 — compatibility patch

- Work around Seanime 3.10.2's mismatch between the documented `src`/`type` fields and the native adapter's `uri`/`format` fields.
- Download the chosen subtitle inside the plugin and supply `content` and `format` to `addExternalSubtitleTrack`.
- Preserve Seanime's native subtitle list, selection, styling, rendering, and delay controls.
- Check subtitle download status and reject empty downloads.
- Prevent an obsolete subtitle download from being added after a newer selection or session change.

Verified live with an SRT subtitle on Seanime 3.10.2: conversion returned HTTP 200, and the selected subtitle appeared as a native file track. This patch changed Subtitle Engine; a Seanime-side fix was proposed separately rather than installed.

## Upstream base

Based on Thekingcrusher's Subtitle Engine 1.1.2. GitHub fork base: `9fdde9570994f8e2ee657915a489235e604ca871` in [Thekingcrusher/seanime-plugins](https://github.com/Thekingcrusher/seanime-plugins). Original authorship and history are retained.
