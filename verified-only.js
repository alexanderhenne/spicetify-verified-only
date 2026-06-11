// verified-only.js - auto-skip tracks whose primary artist lacks the
// "Verified by Spotify" badge (artistUnion.onPlatformReputationTrait.verification.isVerified).
// Note: isRegistered is the old checkmark (claimed profile) and is NOT used here -
// AI bands like The Velvet Sundown are Registered but not Verified.
(function verifiedOnlyInit() {
  if (
    !window.Spicetify?.Player ||
    !Spicetify.GraphQL?.Definitions?.queryArtistOverview ||
    !Spicetify.LocalStorage ||
    !Spicetify.Platform?.PlayerAPI
  ) {
    setTimeout(verifiedOnlyInit, 300);
    return;
  }

  const CACHE_KEY = 'verifiedOnly:v1';
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-check artists weekly
  const MAX_CONSECUTIVE_SKIPS = 5; // guard against skip storms in all-unverified contexts
  const QUEUE_LOOKAHEAD = 10; // upcoming tracks to pre-check per queue update

  let cache;
  try {
    cache = JSON.parse(Spicetify.LocalStorage.get(CACHE_KEY)) || {};
  } catch {
    cache = {};
  }
  const saveCache = () => Spicetify.LocalStorage.set(CACHE_KEY, JSON.stringify(cache));

  const notify = (msg) => {
    try {
      Spicetify.showNotification(msg);
    } catch {
      console.log('[verified-only]', msg);
    }
  };

  // --- Event log, read by the "Verified Blocks" custom app dashboard ---
  const STATS_KEY = 'verifiedOnly:stats';
  const EVENTS_KEY = 'verifiedOnly:events';
  const EVENTS_MAX = 2000; // ring buffer; aggregate counters in STATS_KEY are unbounded

  const readJSON = (key, fallback) => {
    try {
      return JSON.parse(Spicetify.LocalStorage.get(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };

  // User-allowed artists: { artistUri: artistName }, managed from the dashboard.
  // Checked before the verified verdict, so it overrides cached blocks immediately.
  const ALLOWED_KEY = 'verifiedOnly:allowed';
  const isAllowed = (artistUri) => !!readJSON(ALLOWED_KEY, {})[artistUri];

  // type: 'play' | 'skip' (now-playing skipped) | 'prune' (removed from queue)
  function logEvent(type, meta) {
    const stats = readJSON(STATS_KEY, { plays: 0, blocks: 0, byArtist: {} });
    if (type === 'play') {
      stats.plays++;
    } else {
      stats.blocks++;
      const name = meta?.artist_name ?? 'Unknown artist';
      stats.byArtist[name] = (stats.byArtist[name] ?? 0) + 1;
    }
    Spicetify.LocalStorage.set(STATS_KEY, JSON.stringify(stats));

    const events = readJSON(EVENTS_KEY, []);
    events.push({
      t: Date.now(),
      y: type,
      tr: meta?.title ?? null,
      ar: meta?.artist_name ?? null,
      au: meta?.artist_uri ?? null,
    });
    if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
    Spicetify.LocalStorage.set(EVENTS_KEY, JSON.stringify(events));
  }

  // artistUri -> Promise, dedupes concurrent lookups for the same artist
  const pending = new Map();

  // Returns true/false, or null when unknown (lookup failed, schema changed,
  // not an artist URI). null fails open: never block on uncertain data.
  async function isVerified(artistUri) {
    if (typeof artistUri !== 'string' || !artistUri.startsWith('spotify:artist:')) return null;
    const hit = cache[artistUri];
    if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.v;
    if (pending.has(artistUri)) return pending.get(artistUri);

    const lookup = (async () => {
      try {
        const res = await Spicetify.GraphQL.Request(
          Spicetify.GraphQL.Definitions.queryArtistOverview,
          { uri: artistUri, locale: '', includePrerelease: false, enableAssociatedVideos: false }
        );
        const v = res?.data?.artistUnion?.onPlatformReputationTrait?.verification?.isVerified;
        if (typeof v !== 'boolean') return null;
        cache[artistUri] = { v, t: Date.now() };
        saveCache();
        return v;
      } catch {
        return null;
      } finally {
        pending.delete(artistUri);
      }
    })();
    pending.set(artistUri, lookup);
    return lookup;
  }

  // --- Reactive skip: if the now-playing track's artist is unverified, skip it ---
  let consecutiveSkips = 0;
  let lastLoggedKey = null; // songchange can occasionally re-fire for the same item

  async function onSongChange() {
    const item = Spicetify.Player.data?.item;
    const artistUri = item?.metadata?.artist_uri;
    if (!artistUri) {
      // local files, podcasts, ads - leave alone
      consecutiveSkips = 0;
      return;
    }
    const verified = isAllowed(artistUri) ? true : await isVerified(artistUri);
    // playback may have moved on during the async lookup
    if (Spicetify.Player.data?.item?.uri !== item.uri) return;

    const logKey = (item.uid ?? '') + '|' + item.uri;
    const shouldLog = logKey !== lastLoggedKey;
    if (shouldLog) lastLoggedKey = logKey;

    if (verified === false) {
      if (shouldLog) logEvent('skip', item.metadata);
      consecutiveSkips++;
      if (consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
        consecutiveSkips = 0;
        Spicetify.Player.pause();
        notify('Verified-only: too many unverified tracks in a row - paused playback.');
        return;
      }
      notify(
        `Skipped "${item.metadata?.title ?? 'track'}" - ` +
        `${item.metadata?.artist_name ?? 'artist'} is not Verified by Spotify`
      );
      Spicetify.Player.next();
    } else {
      if (shouldLog) logEvent('play', item.metadata);
      consecutiveSkips = 0;
    }
  }

  Spicetify.Player.addEventListener('songchange', onSongChange);
  onSongChange();

  // --- Proactive prune: pre-check upcoming tracks, remove unverified user-queued ones ---
  // Context tracks (implied by the playing album/playlist/radio) can't be removed from
  // the queue, but pre-checking warms the cache so the songchange skip is instant.
  let pruning = false;

  async function pruneQueue() {
    if (pruning) return;
    pruning = true;
    try {
      const upcoming = (Spicetify.Queue?.nextTracks ?? []).slice(0, QUEUE_LOOKAHEAD);
      for (const entry of upcoming) {
        const track = entry.contextTrack;
        const artistUri = track?.metadata?.artist_uri;
        if (!artistUri) continue;
        const verified = isAllowed(artistUri) ? true : await isVerified(artistUri);
        if (verified === false && entry.provider === 'queue') {
          try {
            await Spicetify.removeFromQueue([{ uri: track.uri, uid: track.uid }]);
            logEvent('prune', track.metadata);
            notify(
              `Removed "${track.metadata?.title ?? 'track'}" from queue - ` +
              `${track.metadata?.artist_name ?? 'artist'} is not Verified by Spotify`
            );
          } catch {
            // removal is best-effort; the songchange skip still catches it
          }
        }
      }
    } finally {
      pruning = false;
    }
  }

  Spicetify.Platform.PlayerAPI._events?.addListener?.('queue_update', pruneQueue);
  setInterval(pruneQueue, 15000); // safety net in case the event hook misses updates
  pruneQueue();

  console.log('[verified-only] active');
})();
