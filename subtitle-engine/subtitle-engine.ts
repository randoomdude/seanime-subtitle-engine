/// <reference path="../../core.d.ts" />
/// <reference path="../../plugin.d.ts" />
/// <reference path="../../app.d.ts" />
/// <reference path="../../system.d.ts" />

//@ts-ignore
function init() {
    $ui.register((ctx) => {
        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/Thekingcrusher/seanime-plugins/refs/heads/main/subtitle-engine/icon.png",
            withContent: true,
            width: "600px"
        })

        // Wyzie credentials belong in local extension preferences.

        // --- States & Refs ---
        const imdbId = ctx.state<string>("")
        const seasonNumber = ctx.state<string>("")
        const episodeNumber = ctx.state<string>("")
        const subtitleResults = ctx.state<any[]>([])
        const filteredSubtitleResults = ctx.state<any[]>([])
        const isSearching = ctx.state<boolean>(false)
        const searchError = ctx.state<string>("")
        const wyzieServer = ctx.state<string>("")
        const lastSearchedKey = ctx.state<string>("")
        const selectedSubUrls = ctx.state<string[]>([])
        const activeSession = ctx.state<boolean>(false)
        const autoSelected = ctx.state<string>("")

        let injectionGeneration = 0
        let searchGeneration = 0

        function resetSearchContext() {
            searchGeneration++;
            injectionGeneration++;
            subtitleResults.set([]);
            filteredSubtitleResults.set([]);
            searchError.set("");
            wyzieServer.set("");
            lastSearchedKey.set("");
            autoSelected.set("");
            selectedSubUrls.set([]);
            isSearching.set(false);
        }

        function normalizeSubtitle(sub: any) {
            const language = String(sub.language || "und");
            const display = String(sub.display || language);
            const release = String(sub.release || sub.fileName ||
                (sub.source === "ai" ? "AI translation — " + display : sub.media || "Subtitle — " + display));
            return { ...sub, release, display, language,
                media: String(sub.media || release),
                format: String(sub.format || "srt").toLowerCase(),
                source: String(sub.source || "unknown") };
        }

        const imdbRef = ctx.fieldRef()
        const seasonRef = ctx.fieldRef()
        const episodeRef = ctx.fieldRef()
        const mediaTypeRef = ctx.fieldRef<string>("series")
        const langRef = ctx.fieldRef<string>($getUserPreference("language"))
        const savedSource = $getUserPreference("source");
        const sourceRef = ctx.fieldRef<string>(["animetoshoSource", "jimakuSource"].includes(savedSource) ? savedSource : "all")
        const formatRef = ctx.fieldRef<string>($getUserPreference("format"))
        
        const hiRef = ctx.fieldRef<boolean>(false)
        const savedHi = $getUserPreference("hi")
        hiRef.setValue(savedHi === "true")
        const signRef = ctx.fieldRef<boolean>(false)
        const savedSign = $getUserPreference("signSong")
        signRef.setValue(savedSign === "true")
        const honorRef = ctx.fieldRef<boolean>(false)
        const savedHonor = $getUserPreference("honorifics")
        honorRef.setValue(savedHonor === "true")

        async function injectSubtitle(sub: any) {
            const generation = ++injectionGeneration
            try {
                const data = $habari.parse(sub.media);
                const label = `${data.release_group ? `[${data.release_group}] ` : ``}${sub.display}${sub.isHearingImpaired ? " [CC]" : ""}${sub.isSignSong ? " [Sign/Song]" : ""}${sub.isHonorifics ? " [Honorifics]" : ""} (${sub.format.toUpperCase()})`

                const response = await fetch(sub.url)
                if (!response.ok) throw new Error(`Subtitle download failed (${response.status})`)
                const content = await response.text()
                if (generation !== injectionGeneration) return
                if (!content.trim()) throw new Error("Downloaded subtitle is empty")

                // Seanime 3.10.2's declaration advertises src/type, but its
                // adapter only forwards uri/format. Supplying the downloaded
                // content avoids the broken src field and gives the native
                // player a real file track it can list, select, and render.
                await ctx.videoCore.addExternalSubtitleTrack({
                    content,
                    label,
                    language: sub.language || "und",
                    format: sub.format.toLowerCase(),
                } as any)
                selectedSubUrls.set([sub.url])
                ctx.toast.success(`Subtitle added to Seanime: ${label}`)
            } catch (err) {
                if (generation !== injectionGeneration) return
                ctx.toast.error("Failed to add subtitle to Seanime", err);
                console.log(err)
            }
        }

        async function loadMediaData(anilistId: number) {
            const generation = searchGeneration;
            try {
                const metadata = await ctx.anime.getAnimeMetadata("anilist", anilistId)
                const info = await ctx.videoCore.getCurrentPlaybackInfo();
                if (generation !== searchGeneration) return;
                const mappingImdb = metadata.mappings?.imdbId?.toString();
                const mappingTmdb = metadata.mappings?.themoviedbId?.toString();
                const currentSeason = metadata.episodes["1"]?.seasonNumber?.toString();
                const currentEpisode = info.episode?.episodeNumber?.toString();
                const absoluteEpisode = info.episode?.absoluteEpisodeNumber?.toString();
                const totalEpisodes = info.media?.episodes?.toString();
                const eid = metadata.episodes[currentEpisode]?.anidbId?.toString();
                const currentFormat = info.media?.format?.toUpperCase();
                mediaTypeRef.setValue(currentFormat === "MOVIE" ? "movie" : "series");

                if (sourceRef.current === "animetoshoSource" || sourceRef.current === "jimakuSource") {
                    if (sourceRef.current === "animetoshoSource") await fetchAnimeTosho(eid);
                    if (sourceRef.current === "jimakuSource") await fetchJimaku(anilistId, currentEpisode, absoluteEpisode, totalEpisodes);
                    if (generation !== searchGeneration) return;
                    let results = filteredSubtitleResults.get();
                  
                    if (results.length === 0 && formatRef.current !== "all" && $getUserPreference("autoSelect") === "smart" && !autoSelected.get()) {
                        formatRef.setValue("all");
                        applyFilters();
                        results = filteredSubtitleResults.get();
                    }
                    if (results.length === 0 && hiRef.current && $getUserPreference("autoSelect") === "smart" && !autoSelected.get()) {
                        hiRef.setValue(false);
                        applyFilters();
                        results = filteredSubtitleResults.get();
                    }
                    if (results.length === 0 && signRef.current && $getUserPreference("autoSelect") === "smart" && !autoSelected.get()) {
                        signRef.setValue(false);
                        applyFilters();
                        results = filteredSubtitleResults.get();
                    }
                    if (results.length === 0 && honorRef.current && $getUserPreference("autoSelect") === "smart" && !autoSelected.get()) {
                        honorRef.setValue(false);
                        applyFilters();
                        results = filteredSubtitleResults.get();
                    }
                    if ($getUserPreference("autoSelect") !== "none" && autoSelected.get() !== currentEpisode) {
                        if (results.length > 0) {
                            await injectSubtitle(results[0]);
                            autoSelected.set(currentEpisode);
                        } else {
                            const type = $getUserPreference("autoSelect") === "auto" ? "Auto" : "Smart";
                            ctx.toast.warning(`${type} Select could not find any subtitles`);
                            autoSelected.set(currentEpisode);
                        }
                    }
                    return
                }

                const bestId = mappingTmdb || mappingImdb;
                const fallback = !bestId || !currentSeason;
                const method = $getUserPreference("method");
    
                if (bestId) {
                    imdbId.set(bestId);
                    imdbRef.setValue(bestId);
                }

                if (currentSeason !== "0") {
                  seasonNumber.set(currentSeason);
                  seasonRef.setValue(currentSeason);
                  episodeNumber.set(currentEpisode);
                  episodeRef.setValue(currentEpisode);
                }
        
                if (fallback && currentFormat !== "MOVIE") {
                    console.log(`Metadata missing IDs, falling back to ID mapping method ${method}.`);
                    
                    if (method === "1") {
                        const anidbId = metadata.mappings.anidbId;
                        const res = await fetch("https://raw.githubusercontent.com/Anime-Lists/anime-lists/refs/heads/master/anime-list-full.xml");
                        const xmlText = await res.text();
                        if (generation !== searchGeneration) return;
                        const $ = LoadDoc(xmlText);
                        const animeNode = $(`anime[anidbid="${anidbId}"]`);
    
                        if (animeNode.length) {
                            const tmdbId = animeNode.attr("tmdbtv");
                            const tmdbSeason = animeNode.attr("defaulttvdbseason");
                            if (tmdbId) { imdbId.set(tmdbId); imdbRef.setValue(tmdbId); }
                            if (tmdbSeason !== "0") { seasonNumber.set(tmdbSeason); seasonRef.setValue(tmdbSeason); episodeNumber.set(currentEpisode); episodeRef.setValue(currentEpisode); }
                        }
                    } else if (method === "2") {
                        const res = await fetch(`https://ramregar97-idmapper.hf.space/api/mapper?anilist_id=${anilistId}`);
                        const data = await res.json();
                        if (generation !== searchGeneration) return;
                        imdbId.set(data.tmdb_show_id?.toString() || data.themoviedb_id?.toString() || data.imdb_id?.toString());
                        imdbRef.setValue(data.tmdb_show_id?.toString() || data.themoviedb_id?.toString() || data.imdb_id?.toString());
                        const keys = data.tvdb_mappings ? Object.keys(data.tvdb_mappings) : [];
                        if (keys.length > 0) {
                            const sNum = keys[0].replace("s", "");
                            if (sNum !== "0") {
                                seasonNumber.set(sNum);
                                seasonRef.setValue(sNum);
                                episodeNumber.set(currentEpisode);
                                episodeRef.setValue(currentEpisode);
                            }
                        }
                    }
                }

                if (!bestId && currentFormat === "MOVIE") {
                    console.log(`Metadata missing IDs, falling back to ID mapping movie method ${method}.`);
                    
                    if (method === "1") {
                        const anidbId = metadata.mappings.anidbId;
                        const res = await fetch("https://raw.githubusercontent.com/Anime-Lists/anime-lists/refs/heads/master/anime-list-full.xml");
                        const xmlText = await res.text();
                        if (generation !== searchGeneration) return;
                        const $ = LoadDoc(xmlText);
                        const animeNode = $(`anime[anidbid="${anidbId}"]`);
    
                        if (animeNode.length) {
                            const tmdbId = animeNode.attr("tmdbid");
                            const imdbid = animeNode.attr("imdbid");
                            const tmdbSeason = animeNode.attr("defaulttvdbseason");
                            imdbId.set(tmdbId || imdbid);
                            imdbRef.setValue(tmdbId || imdbid);
                            if (tmdbSeason !== "0") { seasonNumber.set(tmdbSeason); seasonRef.setValue(tmdbSeason); episodeNumber.set(currentEpisode); episodeRef.setValue(currentEpisode); }
                        }
                    } else if (method === "2") {
                        const res = await fetch(`https://ramregar97-idmapper.hf.space/api/mapper?anilist_id=${anilistId}`);
                        const data = await res.json();
                        if (generation !== searchGeneration) return;
                        imdbId.set(data.tmdb_movie_id?.toString() || data.themoviedb_id?.toString() || data.imdb_id?.toString());
                        imdbRef.setValue(data.tmdb_movie_id?.toString() || data.themoviedb_id?.toString() || data.imdb_id?.toString());
                        const keys = data.tvdb_mappings ? Object.keys(data.tvdb_mappings) : [];
                        if (keys.length > 0) {
                            const sNum = keys[0].replace("s", "");
                            if (sNum !== "0") {
                                seasonNumber.set(sNum);
                                seasonRef.setValue(sNum);
                                episodeNumber.set(currentEpisode);
                                episodeRef.setValue(currentEpisode); 
                            }
                        }
                    }
                }

                tray.update();
                  
                if (imdbRef.current) {
                    await fetchSubtitles(true);
                    if (generation !== searchGeneration) return;
                    let results = filteredSubtitleResults.get();
                  
                    if (results.length === 0 && formatRef.current !== "all" && $getUserPreference("autoSelect") === "smart" && !autoSelected.get()) {
                        //await fetchSubtitles(true, { format: "all" });
                        formatRef.setValue("all");
                        applyFilters();
                        results = filteredSubtitleResults.get();
                    }
                    if (results.length === 0 && hiRef.current && $getUserPreference("autoSelect") === "smart" && !autoSelected.get()) {
                        //await fetchSubtitles(true, { format: "all", hi: false });
                        hiRef.setValue(false);
                        applyFilters();
                        results = filteredSubtitleResults.get();
                    }
                    if ($getUserPreference("autoSelect") !== "none" && autoSelected.get() !== currentEpisode) {
                        if (results.length > 0) {
                            await injectSubtitle(results[0]);
                            autoSelected.set(currentEpisode);
                        } else {
                            const type = $getUserPreference("autoSelect") === "auto" ? "Auto" : "Smart";
                            ctx.toast.warning(`${type} Select could not find any subtitles`);
                            autoSelected.set(currentEpisode);
                        }
                    }
                }
            } catch (e) {
                console.error("Mapping error", e);
            }
        }

        async function fetchAnimeTosho(eid: number) {
            if (lastSearchedKey.get() === eid) return;
            isSearching.set(true);
            tray.update();
        
            try {
                const url = `https://feed.animetosho.org/json?eid=${eid}`;
                const res = await fetch(url);
                const allEntries = await res.json();
        
                // 1. Resolution Value Helper
                const getResValue = (title: string): number => {
                    if (/\b2160p\b|\b4k\b/i.test(title)) return 2160;
                    if (/\b1440p\b|\b2k\b/i.test(title)) return 1440;
                    if (/\b1080p\b/i.test(title)) return 1080;
                    if (/\b720p\b/i.test(title)) return 720;
                    if (/\b480p\b/i.test(title)) return 480;
                    return 0;
                };
        
                // 2. DEDUPLICATION: Group by normalized title, pick highest resolution
                const groups: Record<string, any[]> = {};
                allEntries.forEach((entry: any) => {
                    if (entry.title.toLowerCase().includes("batch")) return;
        
                    const normalizedTitle = entry.title
                        .replace(/\b\d{3,4}p\b/gi, "")
                        .replace(/\b4k\b|\b2k\b/gi, "")
                        .replace(/\b(?:avc|hevc|x264|x265|h\.264|h\.265)\b/gi, "")
                        .replace(/\b(?:aac|flac|opus|mp3|dolby|truehd|dts(?:-hd)?(?:\sma)?)\b/gi, "")
                        .replace(/[\[\(][0-9A-F]{8}[\]\)]/gi, "")
                        .replace(/\s+/g, " ")
                        .trim();
        
                    if (!groups[normalizedTitle]) groups[normalizedTitle] = [];
                    groups[normalizedTitle].push(entry);
                });
        
                const entries = Object.values(groups).map(group => {
                    return group.sort((a, b) => getResValue(b.title) - getResValue(a.title))[0];
                });
        
                // 3. CONCURRENCY & RETRY LOGIC
                // Limit max speed to 12. 25 is too high and triggers browser/API bottlenecks.
                const speedPref = $getUserPreference("speed") === "veryfast" || $getUserPreference("speed") === "fast";
                const CONCURRENCY_LIMIT = speedPref ? 12 : 5;
                
                const allTorrents: any[] = [];
                let index = 0;
        
                const fetchWithRetry = async (id: number, retries = 2): Promise<any> => {
                    try {
                        const tRes = await fetch(`https://feed.animetosho.org/json?show=torrent&id=${id}`);
                        
                        // If Rate Limited (429), wait and retry
                        if (tRes.status === 429 && $getUserPreference("speed") === "fast" && retries > 0) {
                            await new Promise(r => ctx.setTimeout(r, 1500));
                            return fetchWithRetry(id, retries - 1);
                        }
                        
                        if (!tRes.ok) return null;
                        return await tRes.json();
                    } catch (e) {
                        if (retries > 0) {
                            await new Promise(r => ctx.setTimeout(r, 1000));
                            return fetchWithRetry(id, retries - 1);
                        }
                        return null;
                    }
                };
        
                const worker = async () => {
                    while (index < entries.length) {
                        const entry = entries[index++];
                        const data = await fetchWithRetry(entry.id);
                        if (data) allTorrents.push(data);
                    }
                };
        
                // Start the worker pool
                await Promise.all(
                    Array(Math.min(CONCURRENCY_LIMIT, entries.length))
                        .fill(null)
                        .map(() => worker())
                );
        
                // 4. DATA TRANSFORMATION
                let results: any[] = [];
                for (const torrent of allTorrents) {
                    if (!torrent?.files) continue;
                    for (const file of torrent.files) {
                        if (!file.attachments) continue;
                        for (const attach of file.attachments) {
                            if (attach.type !== "subtitle") continue;
        
                            const providers = detectProvider(attach.info?.name);
                            const langInfo = resolveLanguage(attach.info?.lang);
                            
                            let language = langInfo.iso2;
                            let flag = langInfo.countryCode;
                            const context = (torrent.title + (attach.info?.name || "")).toLowerCase();
        
                            // Language tagging logic
                            if (langInfo.iso2 === "pt" && /brazil|\bbr\b/i.test(context)) {
                                flag = "BR"; language = "pb";
                            }
                            if (langInfo.iso2 === "zh" && /(hong kong|\bzt\b|traditional)/i.test(context)) {
                                language = "zt";
                            }
                            if (langInfo.iso2 === "es" && /latin america|\bla\b|\blatam\b/i.test(context)) {
                                language = "la";
                            }
        
                            results.push({
                                release: torrent.title,
                                display: langInfo.cleanName,
                                language,
                                format: attach.info?.codec,
                                url: `https://sub.wyzie.io/c/animetosho/id/${attach.id}.animetosho?format=${attach.info?.codec?.toLowerCase()}`,
                                source: "animetosho",
                                isCR: providers.isCR,
                                isNF: providers.isNF,
                                isAMZN: providers.isAMZN,
                                isATX: providers.isATX,
                                isBili: providers.isBili,
                                isIQ: providers.isIQ,
                                isHearingImpaired: /\b(cc|closed? captions?|hi|sdh|hearing impaired)\b/i.test(attach.info?.name || ""),
                                isSignSongs: /\b(signs?|songs?|sign(?:[-_/ ]+)songs?)\b/i.test(attach.info?.name || ""),
                                isHonorifics: /honorific/i.test(attach.info?.name),
                                flagUrl: `https://flagsapi.com/${flag}/flat/64.png`, 
                                media: torrent.title
                            });
                        }
                    }
                }
        
                subtitleResults.set(results);
                applyFilters();
                lastSearchedKey.set(eid);
        
            } catch (err) {
                ctx.toast.error("AnimeTosho (Integrated) search failed");
                console.error(err);
            } finally {
                isSearching.set(false);
            }
        }

        async function fetchJimaku(aniId: number, epNum: number, abEpNum: number, totalEpisodes: number) {
            if (lastSearchedKey.get() === `${aniId}-${epNum}` || !$getUserPreference("jimakuKey")) return;
            const generation = searchGeneration;
            subtitleResults.set([]);
            filteredSubtitleResults.set([]);
            searchError.set("");
            isSearching.set(true);
            tray.update();

            try {
                const searchUrl = `https://jimaku.cc/api/entries/search?anilist_id=${aniId}`;
                const searchRes = await fetch(searchUrl, {
                    headers: {
                          'Authorization': $getUserPreference("jimakuKey")
                      }
                });
                
                if (!searchRes.ok) {
                    throw new Error(`Jimaku ID resolution failed: ${searchRes.status}`);
                }
        
                const searchData = await searchRes.json();
                if (generation !== searchGeneration) return;
                
                if (!searchData || searchData.length === 0) {
                    console.log("No Jimaku entry found for AniList ID:", aniId);
                    return; 
                }
        
                const jimakuId = searchData[0].id;
        
                const filesUrl = `https://jimaku.cc/api/entries/${jimakuId}/files`;
                const filesRes = await fetch(filesUrl, {
                    headers: {
                          'Authorization': $getUserPreference("jimakuKey")
                      }
                });
                
                if (!filesRes.ok) {
                    throw new Error(`Jimaku files fetch failed: ${filesRes.status}`);
                }
        
                const filesData = await filesRes.json();
                if (generation !== searchGeneration) return;
        
                const results = filesData
                    .filter((file) => {
                        if (totalEpisodes === "1") return true;
                          
                        const parsed = $habari.parse(file.name);
                        const parsedEp = Number(parsed.episode_number);

                        return parsedEp === Number(epNum) || parsedEp === Number(abEpNum);
                    })
                    .map((file) => {
                        const formatMatch = file.name.match(/\.([^.]+)$/);
                        const format = formatMatch ? formatMatch[1] : "N/A";
                        const providers = detectProvider(file.name);
        
                        return {
                            release: file.name,
                            display: "Japanese", 
                            language: "ja",
                            format: format,
                            url: file.url,
                            source: "jimaku",
                            isCR: providers.isCR,
                            isNF: providers.isNF,
                            isAMZN: providers.isAMZN,
                            isATX: providers.isATX,
                            isBili: providers.isBili,
                            isIQ: providers.isIQ,
                            isHearingImpaired: /\b(cc|closed? captions?|hi|sdh|hearing impaired)\b/i.test(file.name),
                            isSignSongs: /\b(signs?|songs?|sign(?:[-_/ ]+)songs?)\b/i.test(file.name),
                            isHonorifics: /honorific/i.test(file.name),
                            flagUrl: `https://flagsapi.com/JP/flat/64.png`, 
                            media: file.name
                        };
                    });
        
                subtitleResults.set(results);
                const validLang = "ja" || "all";
                if (langRef.current !== validLang) {
                    langRef.setValue("all")
                }
                applyFilters();
                const currentKey = `${aniId}-${epNum}`;
                lastSearchedKey.set(currentKey);
        
            } catch (err) {
                if (generation !== searchGeneration) return;
                searchError.set("Jimaku search failed. Check your key or try again.");
                ctx.toast.error("Jimaku (Integrated) search failed");
                console.error(err);
            } finally {
                isSearching.set(false);
            }
        }

        async function fetchSubtitles(isAuto = false, overrides: any = {}) {
            const generation = searchGeneration;
            // Manual searches use only the visible fields, never an older playback value.
            const id = isAuto ? (imdbRef.current || imdbId.get()) : imdbRef.current;
            const movie = mediaTypeRef.current === "movie";
            const s = movie ? "" : (isAuto ? (seasonRef.current || seasonNumber.get()) : seasonRef.current);
            const ep = movie ? "" : (isAuto ? (episodeRef.current || episodeNumber.get()) : episodeRef.current);
            if (!id) return ctx.toast.warning("IMDB/TMDB ID not found");
            const key = String($getUserPreference("wyzieKey") || "").trim();
            searchError.set("");
            if (!key) {
                wyzieServer.set("");
                subtitleResults.set([]);
                filteredSubtitleResults.set([]);
                searchError.set("Add your Wyzie API key in Subtitle Engine preferences. Free keys: https://store.wyzie.io/redeem");
                return;
            }
            const backupEnabled = $getUserPreference("wyzieBackup") === "true";
            const currentKey = JSON.stringify([id, movie, s, ep, key, backupEnabled]);
            if (isAuto && lastSearchedKey.get() === currentKey) return;
            wyzieServer.set("");
            isSearching.set(true);
            subtitleResults.set([]);
            filteredSubtitleResults.set([]);
            try {
                let url = "https://sub.wyzie.io/search?id=" + encodeURIComponent(id) + "&source=all";
                if (s && ep) url += "&season=" + encodeURIComponent(s) + "&episode=" + encodeURIComponent(ep);
                url += "&key=" + encodeURIComponent(key);
                const backupUrl = url.replace("https://sub.wyzie.io/", "https://sub.wyzie.ru/");
                let res;
                let usedBackup = false;
                try {
                    res = await fetch(url);
                } catch (err) {
                    if (generation !== searchGeneration) return;
                    if (!backupEnabled) throw err;
                    usedBackup = true;
                    res = await fetch(backupUrl);
                }
                if (generation !== searchGeneration) return;
                // Retry once for outages, never for bad keys, quotas, or an empty search.
                if (!usedBackup && backupEnabled && res.status >= 500 && res.status <= 599) {
                    usedBackup = true;
                    res = await fetch(backupUrl);
                }
                if (generation !== searchGeneration) return;
                wyzieServer.set(usedBackup ? "backup" : "primary");
                let data;
                try {
                    data = await res.json();
                } catch (_) {
                    throw new Error("Wyzie (" + res.status + "): Unexpected response");
                }
                if (generation !== searchGeneration) return;
                if (!res.ok || !Array.isArray(data)) {
                    const message = data && typeof data.message === "string" ? data.message : "Unexpected response";
                    throw new Error("Wyzie (" + res.status + "): " + message);
                }
                subtitleResults.set(data.filter(sub => sub && typeof sub.url === "string" && sub.url).map(normalizeSubtitle));
                signRef.setValue(false);
                honorRef.setValue(false);
                applyFilters();
                lastSearchedKey.set(currentKey);
            } catch (err) {
                if (generation !== searchGeneration) return;
                const message = String(err instanceof Error ? err.message : "Wyzie search failed").replace(/wyzie-[A-Za-z0-9]+/g, "[redacted]");
                searchError.set(message);
                ctx.toast.error(message);
            } finally {
                if (generation === searchGeneration) isSearching.set(false);
            }
        }

        function detectProvider(name: string = "") {
            // 1. Define the regexes for each provider
            const providers = {
                isCR: /(?:^|[^A-Za-z0-9])(CR|Crunchyroll)(?:[^A-Za-z0-9]|$)/i,
                isNF: /(?:^|[^A-Za-z0-9])(NF|Netflix)(?:[^A-Za-z0-9]|$)/i,
                isAMZN: /(?:^|[^A-Za-z0-9])(AMZ|AMZN|Amazon)(?:[^A-Za-z0-9]|$)/i,
                isATX: /(?:^|[^A-Za-z0-9])(ATX|AT-X)(?:[^A-Za-z0-9]|$)/i,
                isBili: /(?:^|[^A-Za-z0-9])(Bili|BiliBili)(?:[^A-Za-z0-9]|$)/i
            };
        
            // 2. Find their positions in the string, sort them, and keep the first 2
            const topMatches = Object.entries(providers)
                .map(([key, regex]) => ({ key, index: name.search(regex) }))
                .filter(match => match.index !== -1)
                .sort((a, b) => a.index - b.index)
                .slice(0, 2)
                .map(match => match.key);
        
            // 3. Return the boolean object based on those top matches
            return {
                isCR: topMatches.includes("isCR"),
                isNF: topMatches.includes("isNF"),
                isAMZN: topMatches.includes("isAMZN"),
                isATX: topMatches.includes("isATX"),
                isBili: topMatches.includes("isBili")
            };
        }

        function resolveLanguage(rawLang: string = "und") {
            const code = rawLang.toLowerCase().trim();
        
            // 2. Map 3-letter (AnimeTosho) to 2-letter (ISO 639-1)
            const toAlpha2: Record<string, string> = {
                "ara": "ar", "chi": "zh", "zho": "zh", "fre": "fr", "fra": "fr",
                "ger": "de", "deu": "de", "ind": "id", "ita": "it", "jpn": "ja",
                "kor": "ko", "may": "ms", "msa": "ms", "por": "pt", "rus": "ru",
                "spa": "es", "tha": "th", "vie": "vi", "eng": "en"
            };
            
            const iso2 = toAlpha2[code] || (code.length === 2 ? code : "en");
        
            // 3. Complete Country Code Map (Wyzie Sub)
            const countryMap: Record<string, string> = {
                af: "ZA", ak: "GH", ar: "SA", az: "AZ", be: "BY", bg: "BG", bn: "BD", bs: "BA", ca: "ES", cs: "CZ", da: "DK", de: "DE", el: "GR", en: "US", eo: "PL", es: "ES", et: "EE", fa: "IR", fi: "FI", fr: "FR", ga: "IE", gd: "GB", he: "IL", hi: "IN", hr: "HR", hu: "HU", hy: "AM", id: "ID", is: "IS", it: "IT", ja: "JP", ka: "GE", kk: "KZ", ko: "KR", lt: "LT", lv: "LV", mk: "MK", mn: "MN", ms: "MY", nb: "NO", nl: "NL", nn: "NO", no: "NO", pl: "PL", pt: "PT", ro: "RO", ru: "RU", sk: "SK", sl: "SI", sq: "AL", sr: "RS", sv: "SE", th: "TH", tr: "TR", uk: "UA", vi: "VN", zh: "CN", ze: "CN", zt: "CN", am: "ET", eu: "ES", gl: "ES", gu: "IN", ha: "NG", ig: "NG", iw: "IL", jv: "ID", km: "KH", kn: "IN", ky: "KG", lo: "LA", mg: "MG", ml: "IN", mr: "IN", my: "MM", ne: "NP", om: "ET", or: "IN", pa: "IN", ps: "AF", si: "LK", so: "SO", sw: "TZ", ta: "IN", te: "IN", tg: "TJ", tk: "TM", ur: "PK", uz: "UZ", yo: "NG", zu: "ZA", as: "IN", ay: "BO", bh: "IN", bi: "VU", br: "FR", ch: "GU", co: "FR", cr: "CA", cy: "GB", dv: "MV", ee: "GH", fj: "FJ", fo: "FO", ff: "SN", gn: "PY", ht: "HT", hz: "NA", ia: "FR", ie: "FR", ik: "US", kl: "GL", ki: "KE", kj: "AO", ku: "IQ", lb: "LU", lg: "UG", ln: "CD", lu: "CD", mh: "MH", na: "NR", nd: "ZW", ng: "NA", nr: "ZA", nv: "US", ny: "MW", oc: "FR", oj: "CA", os: "RU", pi: "IN", qu: "PE", rn: "BI", rw: "RW", sa: "IN", sc: "IT", sd: "PK", sg: "CF", sm: "WS", sn: "ZW", ss: "SZ", st: "LS", su: "ID", tl: "PH", tn: "BW", ts: "ZA", tt: "RU", tw: "GH", ty: "PF", ug: "CN", ve: "ZA", vo: "DE", wa: "BE", wo: "SN", xh: "ZA", yi: "IL", za: "CN"
            };
        
            // 4. Complete Metadata Map (SubDL)
            const metaMap: Record<string, {name: string}> = {
                ab: { name: "Abkhaz" }, aa: { name: "Afar" }, af: { name: "Afrikaans" }, ak: { name: "Akan" }, sq: { name: "Albanian" }, am: { name: "Amharic" }, ar: { name: "Arabic" }, an: { name: "Aragonese" }, hy: { name: "Armenian" }, as: { name: "Assamese" }, av: { name: "Avaric" }, ae: { name: "Avestan" }, ay: { name: "Aymara" }, az: { name: "Azerbaijani" }, bm: { name: "Bambara" }, ba: { name: "Bashkir" }, eu: { name: "Basque" }, be: { name: "Belarusian" }, bn: { name: "Bengali" }, bh: { name: "Bihari" }, bi: { name: "Bislama" }, bs: { name: "Bosnian" }, br: { name: "Breton" }, bg: { name: "Bulgarian" }, my: { name: "Burmese" }, ca: { name: "Catalan" }, ch: { name: "Chamorro" }, ce: { name: "Chechen" }, ny: { name: "Chichewa" }, zh: { name: "Chinese" }, cv: { name: "Chuvash" }, kw: { name: "Cornish" }, co: { name: "Corsican" }, cr: { name: "Cree" }, hr: { name: "Croatian" }, cs: { name: "Czech" }, da: { name: "Danish" }, dv: { name: "Divehi" }, nl: { name: "Dutch" }, en: { name: "English" }, eo: { name: "Esperanto" }, et: { name: "Estonian" }, ee: { name: "Ewe" }, fo: { name: "Faroese" }, fj: { name: "Fijian" }, fi: { name: "Finnish" }, fr: { name: "French" }, ff: { name: "Fula" }, gl: { name: "Galician" }, ka: { name: "Georgian" }, de: { name: "German" }, el: { name: "Greek" }, gn: { name: "Guaraní" }, gu: { name: "Gujarati" }, ht: { name: "Haitian" }, ha: { name: "Hausa" }, he: { name: "Hebrew" }, hz: { name: "Herero" }, hi: { name: "Hindi" }, ho: { name: "Hiri Motu" }, hu: { name: "Hungarian" }, ia: { name: "Interlingua" }, id: { name: "Indonesian" }, ga: { name: "Irish" }, ig: { name: "Igbo" }, ik: { name: "Inupiaq" }, io: { name: "Ido" }, is: { name: "Icelandic" }, it: { name: "Italian" }, iu: { name: "Inuktitut" }, ja: { name: "Japanese" }, jv: { name: "Javanese" }, kl: { name: "Greenlandic" }, kn: { name: "Kannada" }, kr: { name: "Kanuri" }, ks: { name: "Kashmiri" }, kk: { name: "Kazakh" }, km: { name: "Khmer" }, ki: { name: "Kikuyu" }, rw: { name: "Kinyarwanda" }, ky: { name: "Kirghiz" }, kv: { name: "Komi" }, kg: { name: "Kongo" }, ko: { name: "Korean" }, ku: { name: "Kurdish" }, kj: { name: "Kwanyama" }, la: { name: "Latin" }, lb: { name: "Luxembourgish" }, lg: { name: "Luganda" }, li: { name: "Limburgish" }, ln: { name: "Lingala" }, lo: { name: "Lao" }, lt: { name: "Lithuanian" }, lu: { name: "Luba-Katanga" }, lv: { name: "Latvian" }, gv: { name: "Manx" }, mk: { name: "Macedonian" }, mg: { name: "Malagasy" }, ms: { name: "Malay" }, ml: { name: "Malayalam" }, mt: { name: "Maltese" }, mi: { name: "Māori" }, mr: { name: "Marathi" }, mh: { name: "Marshallese" }, mn: { name: "Mongolian" }, na: { name: "Nauru" }, nv: { name: "Navajo" }, nb: { name: "Norwegian Bokmål" }, nd: { name: "North Ndebele" }, ne: { name: "Nepali" }, ng: { name: "Ndonga" }, nn: { name: "Norwegian Nynorsk" }, no: { name: "Norwegian" }, ii: { name: "Nuosu" }, nr: { name: "South Ndebele" }, oc: { name: "Occitan" }, oj: { name: "Ojibwe" }, om: { name: "Oromo" }, or: { name: "Oriya" }, os: { name: "Ossetian" }, pa: { name: "Panjabi" }, pi: { name: "Pāli" }, fa: { name: "Persian" }, pl: { name: "Polish" }, ps: { name: "Pashto" }, pt: { name: "Portuguese" }, qu: { name: "Quechua" }, rm: { name: "Romansh" }, rn: { name: "Kirundi" }, ro: { name: "Romanian" }, ru: { name: "Russian" }, sa: { name: "Sanskrit" }, sc: { name: "Sardinian" }, sd: { name: "Sindhi" }, se: { name: "Northern Sami" }, sm: { name: "Samoan" }, sg: { name: "Sango" }, sr: { name: "Serbian" }, gd: { name: "Scottish Gaelic" }, sn: { name: "Shona" }, si: { name: "Sinhala" }, sk: { name: "Slovak" }, sl: { name: "Slovene" }, so: { name: "Somali" }, st: { name: "Southern Sotho" }, es: { name: "Spanish" }, su: { name: "Sundanese" }, sw: { name: "Swahili" }, ss: { name: "Swati" }, sv: { name: "Swedish" }, ta: { name: "Tamil" }, te: { name: "Telugu" }, tg: { name: "Tajik" }, th: { name: "Thai" }, ti: { name: "Tigrinya" }, bo: { name: "Tibetan" }, tk: { name: "Turkmen" }, tl: { name: "Tagalog" }, tn: { name: "Tswana" }, to: { name: "Tonga" }, tr: { name: "Turkish" }, ts: { name: "Tsonga" }, tt: { name: "Tatar" }, tw: { name: "Twi" }, ty: { name: "Tahitian" }, ug: { name: "Uighur" }, uk: { name: "Ukrainian" }, ur: { name: "Urdu" }, uz: { name: "Uzbek" }, ve: { name: "Venda" }, vi: { name: "Vietnamese" }, vo: { name: "Volapük" }, wa: { name: "Walloon" }, cy: { name: "Welsh" }, wo: { name: "Wolof" }, fy: { name: "Western Frisian" }, xh: { name: "Xhosa" }, yi: { name: "Yiddish" }, yo: { name: "Yoruba" }, za: { name: "Zhuang" }, pb: { name: "Portuguese (Brazil)" }, ze: { name: "Chinese (Simplified)" }, zt: { name: "Chinese (Traditional)" }, iw: { name: "Hebrew" }
            };
        
            return {
                iso2: iso2,
                countryCode: countryMap[iso2],
                cleanName: metaMap[iso2]?.name
            };
        }

        function applyFilters() {
            let filteredSubs = [...subtitleResults.get()];
            const format = formatRef.current;
            const lang = langRef.current;
            const hi = hiRef.current;
            const sign = signRef.current;
            const honor = honorRef.current;
        
            if (format && format !== "all") {
                filteredSubs = filteredSubs.filter(sub => sub.format.toLowerCase() === format.toLowerCase());
            }
        
            if (lang === "spanish") {
                filteredSubs = filteredSubs.filter(sub => {
                    const code = String(sub.language || "").toLowerCase().replace(/_/g, "-");
                    return code === "es" || code.startsWith("es-") || code === "ea" || code === "spa" ||
                        (sourceRef.current === "animetoshoSource" && code === "la");
                });
            } else if (lang && lang !== "all") {
                if (sourceRef.current === "animetoshoSource" && lang === "ea") {
                    filteredSubs = filteredSubs.filter(sub => sub.language === "la");
                }
                else { filteredSubs = filteredSubs.filter(sub => sub.language === lang); }
            }
        
            if (hi) {
                filteredSubs = filteredSubs.filter(sub => sub.isHearingImpaired === true);
            }
        
            if (sign) {
                filteredSubs = filteredSubs.filter(sub => sub.isSignSongs === true);
            }
        
            if (honor) {
                filteredSubs = filteredSubs.filter(sub => sub.isHonorifics === true);
            }
        
            filteredSubtitleResults.set(filteredSubs);
        }

        ctx.registerEventHandler("filter", () => {
            ctx.setTimeout(() => {
                applyFilters();
            }, 50);
        });
        
        ctx.registerEventHandler("update", () => {
            resetSearchContext();
            ctx.setTimeout(async () => {
                if (activeSession.get()) {
                    const info = await ctx.videoCore.getCurrentPlaybackInfo();
                    if (info.media?.id) loadMediaData(parseInt(info.media.id));
                }
                tray.update();
            }, 50);
        });

        ctx.registerEventHandler("triggerManualSearch", () => {
            const id = imdbRef.current;
            const s = seasonRef.current;
            const e = episodeRef.current;
          
            if (!id) return ctx.toast.warning("IMDB/TMDB ID is required");
            if (mediaTypeRef.current !== "movie") {
                if (s && !e) return ctx.toast.warning("Episode number required");
                if (!s && e) return ctx.toast.warning("Season number required");
            }

            resetSearchContext();
            fetchSubtitles(false);
        });

        ctx.registerEventHandler("searchTypeChanged", () => {
            resetSearchContext();
            tray.update();
        });
        
        let currentAnimeId = 0
        ctx.videoCore.addEventListener("video-loaded", () => {
            resetSearchContext()
            selectedSubUrls.set([])
            autoSelected.set("")
            if (activeSession.get() && currentAnimeId && $getUserPreference("autoSelect") !== "none") {
                loadMediaData(currentAnimeId)
            }
        })

        ctx.screen.onNavigate(async (e) => {
            resetSearchContext();
            imdbId.set(""); imdbRef.setValue("");
            seasonNumber.set(""); seasonRef.setValue("");
            episodeNumber.set(""); episodeRef.setValue("");
            mediaTypeRef.setValue("series");
            if (e.pathname === "/entry" && e.searchParams.id) {
                currentAnimeId = parseInt(e.searchParams.id)
                activeSession.set(true);
                selectedSubUrls.set([]);
                autoSelected.set("")
                langRef.setValue($getUserPreference("language"));
                const preferredSource = $getUserPreference("source");
                sourceRef.setValue(["animetoshoSource", "jimakuSource"].includes(preferredSource) ? preferredSource : "all");
                formatRef.setValue($getUserPreference("format"));
            }
            else {
                currentAnimeId = 0
                activeSession.set(false)
                injectionGeneration++
                selectedSubUrls.set([])
            }
        });

        tray.onOpen(async () => {
            if (activeSession.get()) {
                const info = await ctx.videoCore.getCurrentPlaybackInfo();
                loadMediaData(parseInt(info.media.id));           
            }
        })

        tray.render(() => {
            const subs = filteredSubtitleResults.get() || [];
            const currentlySelectedList = selectedSubUrls.get() || [];
            const integrated = sourceRef.current === "animetoshoSource" || sourceRef.current === "jimakuSource";
            const jimaku = sourceRef.current === "jimakuSource"

            return tray.div([
                tray.css(`                 
                    .subtitle-item { transition: all 0.3s ease !important; margin: 0 8px; border-radius: 8px !important; }
                    .subtitle-item:hover { background-color: rgba(255, 255, 255, 0.10) !important; }
                `),
                tray.div([
                    tray.div([
                        tray.flex([
                            tray.stack([
                                tray.text("Subtitle Engine", { style: { fontSize: "18px", fontWeight: "700", color: "#FFF" } }),
                                tray.text(wyzieServer.get() === "backup" ? "Powered by Wyzie · backup server" : "Powered by Wyzie", { style: { fontSize: "11px", opacity: 0.5 } })
                            ]),
                            isSearching.get() 
                                ? tray.badge("Syncing Providers...", { intent: "warning" }) 
                                : tray.badge(`${subs.length} items found`, { intent: subs.length > 0 ? "success" : "gray" })
                        ], { justifyContent: "space-between", alignItems: "center" })
                    ], { style: { padding: "20px 20px 15px 20px" } }),

                    tray.stack([
                        !integrated && tray.select("Search type", {
                            fieldRef: mediaTypeRef,
                            onChange: "searchTypeChanged",
                            options: [
                                { label: "Series", value: "series" },
                                { label: "Movie", value: "movie" }
                            ],
                            style: { width: "160px" }
                        }),
                        tray.flex([
                            !integrated && tray.input({ label: "IMDB/TMDB ID", fieldRef: imdbRef, style: { flex: 2 } }),
                            !integrated && mediaTypeRef.current !== "movie" && tray.input({ label: "S", fieldRef: seasonRef, style: { width: "55px" } }),
                            !integrated && mediaTypeRef.current !== "movie" && tray.input({ label: "E", fieldRef: episodeRef, style: { width: "55px" } }),
                            !integrated && tray.button({ 
                                label: "Search", 
                                onClick: "triggerManualSearch", 
                                intent: isSearching.get() ? "gray" : "white-subtle",
                                disabled: isSearching.get() || !imdbRef.current,
                                style: { marginTop: "24px", height: "38px" } 
                            })
                        ].filter(Boolean), { gap: 1 }),

                        tray.flex([
                            tray.select("Source", {
                                fieldRef: sourceRef,
                                onChange: "update",
                                options: [
                                  { label: "AnimeTosho (Integrated)", value: "animetoshoSource" },
                                  { label: "Jimaku (Integrated)", value: "jimakuSource" },
                                  { label: "Wyzie — available sources", value: "all" }
                                ],
                                style: { flex: 1 }
                            }),
                            !jimaku && tray.select("Language", {
                                fieldRef: langRef,
                                onChange: "filter",
                                options: [
                                    { label: "All", value: "all" },
                                    { label: "English", value: "en" },
                                    { label: "Spanish (all variants)", value: "spanish" },
                                    { label: "Spanish (ES)", value: "es" },
                                    { label: "Spanish (LA)", value: "ea" },
                                    { label: "French", value: "fr" },
                                    { label: "German", value: "de" },
                                    { label: "Italian", value: "it" },
                                    { label: "Portuguese (PT)", value: "pt" },
                                    { label: "Portuguese (BR)", value: "pb" },
                                    { label: "Japanese", value: "ja" },
                                    { label: "Korean", value: "ko" },
                                    { label: "Chinese (Simplified)", value: "zh" },
                                    { label: "Chinese (Traditional)", value: "zt" },
                                    { label: "Russian", value: "ru" },
                                    { label: "Arabic", value: "ar" },
                                    { label: "Turkish", value: "tr" },
                                    { label: "Indonesian", value: "id" },
                                    { label: "Vietnamese", value: "vi" },
                                    { label: "Thai", value: "th" },
                                    { label: "Hindi", value: "hi" },
                                    { label: "Bengali", value: "bn" },
                                    { label: "Malay", value: "ms" },
                                    { label: "Tagalog", value: "tl" },
                                    { label: "Persian", value: "fa" },
                                    { label: "Hebrew", value: "he" },
                                    { label: "Polish", value: "pl" },
                                    { label: "Dutch", value: "nl" },
                                    { label: "Greek", value: "el" },
                                    { label: "Czech", value: "cs" },
                                    { label: "Hungarian", value: "hu" },
                                    { label: "Romanian", value: "ro" },
                                    { label: "Swedish", value: "sv" },
                                    { label: "Danish", value: "da" },
                                    { label: "Finnish", value: "fi" },
                                    { label: "Norwegian", value: "no" },
                                    { label: "Ukrainian", value: "uk" },
                                    { label: "Bulgarian", value: "bg" },
                                    { label: "Slovak", value: "sk" },
                                    { label: "Croatian", value: "hr" },
                                    { label: "Serbian", value: "sr" },
                                    { label: "Slovenian", value: "sl" },
                                    { label: "Lithuanian", value: "lt" },
                                    { label: "Latvian", value: "lv" },
                                    { label: "Estonian", value: "et" },
                                    { label: "Icelandic", value: "is" },
                                    { label: "Albanian", value: "sq" },
                                    { label: "Armenian", value: "hy" },
                                    { label: "Azerbaijani", value: "az" },
                                    { label: "Basque", value: "eu" },
                                    { label: "Belarusian", value: "be" },
                                    { label: "Bosnian", value: "bs" },
                                    { label: "Catalan", value: "ca" },
                                    { label: "Galician", value: "gl" },
                                    { label: "Georgian", value: "ka" },
                                    { label: "Gujarati", value: "gu" },
                                    { label: "Kazakh", value: "kk" },
                                    { label: "Khmer", value: "km" },
                                    { label: "Macedonian", value: "mk" },
                                    { label: "Malayalam", value: "ml" },
                                    { label: "Marathi", value: "mr" },
                                    { label: "Mongolian", value: "mn" },
                                    { label: "Nepali", value: "ne" },
                                    { label: "Punjabi", value: "pa" },
                                    { label: "Sinhala", value: "si" },
                                    { label: "Tamil", value: "ta" },
                                    { label: "Telugu", value: "te" },
                                    { label: "Urdu", value: "ur" },
                                    { label: "Uzbek", value: "uz" },
                                    { label: "Welsh", value: "cy" }
                                ],
                                style: { flex: 1 }
                            }),
                            tray.select("Format", {
                                fieldRef: formatRef,
                                onChange: "filter",
                                options: [
                                  { label: "All", value: "all" },
                                  { label: "ASS", value: "ass" },
                                  { label: "SSA", value: "ssa" },
                                  { label: "SRT", value: "srt" },
                                  { label: "VTT", value: "vtt" }
                                ],
                                style: { flex: 1 }
                            })
                        ].filter(Boolean), { gap: 1 }),

                        tray.flex([
                            tray.switch("Closed Captions (CC)", { fieldRef: hiRef, onChange: "filter" }),
                            integrated && tray.switch("Sign/Song", { fieldRef: signRef, onChange: "filter" }),
                            integrated && tray.switch("Honorifics", { fieldRef: honorRef, onChange: "filter" }),
                        ].filter(Boolean), { padding: "4px 0" })
                    ].filter(Boolean), { style: { padding: "0 20px 20px 20px", borderBottom: "3px solid rgba(255,255,255,0.08)" }, gap: 1.2 }),

                    tray.div([
                        searchError.get() ?
                            tray.text(searchError.get(), { style: { padding: "20px", color: "#ffb4b4" } }) :
                        isSearching.get() ? 
                            tray.div([tray.text("Searching...", { style: { textAlign: "center", padding: "60px", opacity: 0.5 } })]) : 
                        subs.length === 0 ?
                            tray.stack([
                                (activeSession.get() && ["es", "ea", "pb", "pt", "zh", "zt"].includes(langRef.current)) && !integrated ?
                                    tray.alert({
                                        title: "Smart Tip",
                                        description: 
                                            langRef.current === "es" ? "Try switching to Spanish (LA). It might contain Spanish (ES)." :
                                            langRef.current === "ea" ? "Try switching to Spanish (ES). It might contain Spanish (LA)." :
                                            langRef.current === "pb" ? "Try switching to Portuguese (PT). It might contain Portuguese (BR)." :
                                            langRef.current === "pt" ? "Try switching to Portuguese (BR). It might contain Portuguese (PT)." :
                                            langRef.current === "zt" ? "Try switching to Chinese (Traditional). It might contain Chinese (Simplified)" :
                                            "Try switching to Chinese (Simplified). It might contain Chinese (Traditional).",
                                        intent: "info",
                                        style: { margin: "20px 20px 0px 20px" }
                                    }) : tray.div([]),

                                activeSession.get() && jimaku && !$getUserPreference("jimakuKey") ?
                                    tray.alert({
                                        title: "API Key Required",
                                        description: "Please set your Jimaku API key in the extension preferences. To obtain one, register an account at https://jimaku.cc/login, then navigate to https://jimaku.cc/account to generate your key.",
                                        intent: "alert",
                                        style: { margin: "20px 20px 0px 20px" }
                                    }) : tray.div([]),
                        
                                activeSession.get() ? 
                                    tray.alert({
                                        title: "No Results",
                                        description: "Try changing your search parameters or source.",
                                        intent: "warning",
                                        style: { margin: "20px" }
                                    }) : 
                                    tray.alert({
                                        title: "No Active Session Found",
                                        description: "Subtitle Engine is only compatible with Seanime's built-in player. Please start a video for auto search, or enter an ID manually.",
                                        intent: "warning",
                                        style: { margin: "20px" }
                                    })
                            ]) :
                        tray.stack(subs.map((rawSub, i) => {
                            const sub = normalizeSubtitle(rawSub);
                            const isThisSelected = currentlySelectedList.includes(sub.url);

                            return tray.flex([
                                tray.stack([
                                    tray.text(sub.release, { style: { fontSize: "15px", fontWeight: "600", color: "#efefef" }, maxLines: 1 }),
                                    tray.flex([
                                        tray.flex([
                                            sub.flagUrl && tray.img(sub.flagUrl, { style: { width: "18px", height: "12px", borderRadius: "1px", objectFit: "cover", flexShrink: 0 } }),
                                            tray.text(`${sub.display.toUpperCase()} (${sub.language.toUpperCase()})`, { 
                                                style: { fontSize: "12px", fontWeight: "700", color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", lineHeight: "12px", marginTop: "0.5px" } 
                                            })
                                        ].filter(Boolean), { gap: 0.6, alignItems: "center", style: { backgroundColor: "rgba(255,255,255,0.12)", padding: "2px 8px", borderRadius: "100px", border: "1px solid rgba(255,255,255,0.2)", height: "18px", flexShrink: 0 } }),
                                        sub.isCR && tray.badge("CR", { intent: "warning", size: "sm" }),
                                        sub.isNF && tray.badge("NF", { intent: "alert", size: "sm" }),
                                        sub.isAMZN && tray.badge("AMZN", { intent: "info", size: "sm" }),
                                        sub.isATX && tray.badge("AT-X", { intent: "success", size: "sm" }),
                                        sub.isBili && tray.badge("Bili", { intent: "info", size: "sm" }),
                                        tray.badge(sub.format.toUpperCase(), { intent: "primary", size: "sm" }),
                                        sub.isHearingImpaired && tray.badge("CC", { intent: "info", size: "sm" }),
                                        sub.isSignSongs && tray.badge("Sign/Song", { intent: "info", size: "sm" }),
                                        sub.isHonorifics && tray.badge("Honorifics", { intent: "info", size: "sm" }),
                                        tray.text(`• ${sub.source}`, { style: { fontSize: "11px", opacity: 0.4, marginLeft: "2px" } })
                                    ].filter(Boolean), { gap: 0.8, alignItems: "center" })
                                ], { style: { flex: 1 }, gap: 0.5 }),

                                tray.button({
                                    label: isThisSelected ? "Active" : "Select",
                                    size: "sm",
                                    intent: isThisSelected ? "gray" : "primary",
                                    disabled: isThisSelected,
                                    onClick: ctx.eventHandler(`inject-${i}`, () => injectSubtitle(sub))
                                })
                            ], { 
                                className: "subtitle-item",
                                style: { padding: "14px 20px", borderBottom: "3px solid rgba(255,255,255,0.08)", alignItems: "center", marginTop: i === 0 ? "8px" : "0" } 
                            })
                        }))
                    ])
                ], { style: { display: "flex", flexDirection: "column", height: "100%" } })
            ], { style: { width: "100%", height: "100%" } })
        })
    })
}
