# Validation and known limitations

## Confirmed

- The August native subtitle workaround succeeded on Seanime 3.10.2. The user confirmed subtitle playback.
- Local versions 1.1.5 and 1.1.6 initialized on Seanime 3.10.3.
- A personal free Wyzie key authenticated successfully. A direct request matching the plugin's Death Note season 1 episode 1 search returned HTTP 200, with Spanish results. A Spanish SSA subtitle download also returned HTTP 200.
- A later live response included unnamed AI translation entries. A strict render fixture reproduced the `text is required` failure before the 1.1.6 correction and passed after it.
- Saved Jimaku and Wyzie preferences were preserved during the local 1.1.6 update.
- The user supplied a screenshot showing a selected Jimaku ASS subtitle rendering on Seanime 3.10.3 after the 1.1.6 correction.
- Direct live requests to both `sub.wyzie.io` and `sub.wyzie.ru` accepted the same saved personal key and returned HTTP 200 with Spanish results for Death Note season 1 episode 1.

Catalog counts varied between requests, so they are not used as a permanent guarantee of availability.

## Automated fixtures

`npm test` checks TypeScript syntax, missing keys, HTTP 403 and 429 handling, current source parameters, Spanish language variants, repeated automatic searches, native subtitle injection, null-title rendering, an empty Jimaku response, and a late Wyzie response after navigation.

Version 1.1.7 also checks manual and automatic movie searches, cached playback field isolation, movie metadata detection, Auto Select None, HTTP/network failover, preservation of query parameters, disabled backup, no retries for 4xx/empty/malformed-success responses, at most one retry, and no failover from an obsolete context.

These fixtures use mock responses. They do not replace a live playback test or validate every provider and subtitle format.

## Still to verify

- Select and render a real Spanish result through the installed plugin.
- Exercise Movie mode and the backup-server preference in the actual Seanime tray. Outage behavior is verified with fixtures, rather than deliberately disrupting the live service.
- Switch between Wyzie and Jimaku during playback and confirm the corrected interface behaves normally.
- Verify additional shows, episodes, and subtitle formats.

## Known limitations

- Wyzie availability depends on its current sources and the supplied key's access tier. Some results may be AI translation entries; these are explicitly labelled.
- AnimeTosho Integrated's existing conversion URL was not updated or verified during this work.
- Context guards cover Wyzie and Jimaku searches. The original AnimeTosho Integrated asynchronous implementation has not received the same complete response-isolation checks.
- The original third-party ID mapping and fallback logic are retained. Incorrect season or episode mappings can still produce irrelevant searches.
- The backup retries search requests only. It does not rewrite signed subtitle download URLs. Infrastructure independence between the two Wyzie hosts has not been verified.
- The plugin's native subtitle integration is intended for Seanime's built-in player. External player integration was not tested.

## Sources

- [Original Subtitle Engine](https://github.com/Thekingcrusher/seanime-plugins/tree/main/subtitle-engine)
- [Seanime 3.10.2 native adapter](https://github.com/5rahim/seanime/blob/v3.10.2/internal/videocore/adapter.go)
- [Wyzie API key documentation](https://docs.wyzie.io/subs/usage/api-keys)
- [Wyzie source documentation](https://docs.wyzie.io/subs/sources)
