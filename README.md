# Subtitle Engine — Compatibility Fork

A community fork of [Thekingcrusher's Subtitle Engine](https://github.com/Thekingcrusher/seanime-plugins/tree/main/subtitle-engine), maintained by [randoomdude](https://github.com/randoomdude).

This fork restores native subtitle loading in Seanime, supports a personal Wyzie key, and improves Spanish filtering and result handling. Original plugin credit belongs to Thekingcrusher. Compatibility changes were developed with Codex.

**Current version: 1.1.6. Status: testing.** Automated regression tests pass, the plugin initializes on Seanime 3.10.3, and live Wyzie searches and downloads succeeded. Playback after the latest result-handling correction still needs user confirmation. See [validation and limitations](docs/VALIDATION.md).

GitHub forks repositories rather than individual plugins. This repository retains the original repository history and its `skip-data-manager` directory. Changes here apply to Subtitle Engine.

## Changes

- Downloads subtitles and passes their content and format to Seanime's native subtitle manager, working around the Seanime 3.10.2 API field mismatch.
- Adds a **Wyzie API Key** preference instead of shipping the rejected shared key.
- Queries Wyzie's currently available sources using `source=all` instead of obsolete provider names.
- Adds **Spanish (all variants)**, including regional Spanish language codes.
- Displays authentication and quota errors instead of presenting them as empty searches.
- Labels unnamed results safely, including AI translation entries, preventing `TypeError: text is required`.
- Clears old results when changing shows or providers, and ignores obsolete Wyzie and Jimaku responses.
- Uses language-filtered results for automatic Wyzie selection.
- Supports manual IMDb/TMDB searches outside an active playback session.

See [CHANGELOG.md](CHANGELOG.md) for the version history.

## Install

Install using Seanime's extension installer with this manifest URL:

```text
https://raw.githubusercontent.com/randoomdude/seanime-subtitle-engine/main/subtitle-engine/manifest.json
```

The extension ID remains `subtitle-engine`, so this build replaces the original rather than installing a second copy. Back up any personal code edits first. Existing preferences should remain associated with that ID.

For a manual source replacement, open [subtitle-engine/subtitle-engine.ts](subtitle-engine/subtitle-engine.ts), copy the entire source, paste it into Subtitle Engine's code editor in Seanime, and save. This method alone does not add the new preference fields: install the fork manifest first if **Wyzie API Key** or **Spanish (all variants)** is absent.

## Set up Spanish subtitles

1. Get a personal key from [Wyzie's free-key page](https://store.wyzie.io/redeem).
2. Open **Extensions → Subtitle Engine → Preferences** in Seanime.
3. Enter the key in **Wyzie API Key** and save.
4. Select **Wyzie — available sources**, **Spanish (all variants)**, and **All** formats.
5. Start a show, open Subtitle Engine, and select a Spanish result. For the first test, turn **Auto Select** off so you can choose the intended track.

Death Note season 1 episode 1 is a useful manual test: IMDb/TMDB ID **13916**, season **1**, episode **1**. Select an SRT result first, then confirm that it appears and renders in the player's subtitle menu. If no Spanish results appear, try **All** languages to distinguish catalog availability from a failed search.

Wyzie source availability and free-tier access can change. [Wyzie's source documentation](https://docs.wyzie.io/subs/sources) describes the current rules. Spanish results are not guaranteed for every episode. Results explicitly labelled **AI translation** are generated translations rather than provider releases.

**Jimaku (Integrated)** continues to use its separate **Jimaku API Key** preference and primarily supplies Japanese subtitles.

## Development

Use Node.js 20 or later:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Edit `subtitle-engine/subtitle-engine.ts`. The build command copies it into the manifest's inline payload. Commit both the source and regenerated manifest. Tests use mocked network responses and do not need personal API keys.

Keep API keys in local Seanime preferences. Repository files contain no personal keys, settings backups, or playback logs.

## Attribution

- Original repository: [Thekingcrusher/seanime-plugins](https://github.com/Thekingcrusher/seanime-plugins).
- Original Subtitle Engine author: **Thekingcrusher**.
- Fork maintainer: **randoomdude**, with compatibility changes developed using Codex.
- Seanime itself is developed separately by [5rahim](https://github.com/5rahim/seanime). This fork changes the plugin; it does not include a modified Seanime executable.
