// Verified Blocks - Pi-hole-style dashboard for the verified-only extension.
// Reads the play/block log the extension keeps in LocalStorage.

function render() {
  return Spicetify.React.createElement(VerifiedBlocksApp);
}

const VB_CSS = `
.vb-root { padding: 24px 32px; color: var(--spice-text, #fff); }
.vb-root h1 { font-size: 28px; margin: 0 0 4px; }
.vb-sub { opacity: .6; margin-bottom: 24px; font-size: 14px; }
.vb-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; margin-bottom: 28px; }
.vb-card { border-radius: 10px; padding: 18px 20px; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
.vb-card .vb-num { font-size: 34px; font-weight: 700; line-height: 1.1; }
.vb-card .vb-label { font-size: 13px; opacity: .85; margin-top: 4px; }
.vb-green { background: linear-gradient(135deg, #00a65a, #008d4c); }
.vb-red { background: linear-gradient(135deg, #dd4b39, #c23321); }
.vb-orange { background: linear-gradient(135deg, #f39c12, #d8870b); }
.vb-blue { background: linear-gradient(135deg, #00c0ef, #00a7d0); }
.vb-panel { background: rgba(255,255,255,.06); border-radius: 10px; padding: 18px 20px; margin-bottom: 24px; }
.vb-panel h2 { font-size: 15px; margin: 0 0 14px; opacity: .85; }
.vb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.vb-table th { text-align: left; opacity: .55; font-weight: 600; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,.12); }
.vb-table td { padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,.06); }
.vb-badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
.vb-badge-skip { background: #dd4b39; }
.vb-badge-prune { background: #f39c12; }
.vb-barrow { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
.vb-barrow .vb-name { width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vb-barrow .vb-bar { flex: 1; height: 14px; background: rgba(255,255,255,.08); border-radius: 7px; overflow: hidden; }
.vb-barrow .vb-bar > div { height: 100%; background: #dd4b39; }
.vb-empty { opacity: .5; font-size: 13px; }
.vb-btn { background: #00a65a; border: none; color: #fff; border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
.vb-btn:hover { opacity: .85; }
.vb-btn:disabled { opacity: .4; cursor: default; }
.vb-btn-danger { background: #dd4b39; }
.vb-btn-ghost { background: rgba(255,255,255,.12); }
.vb-wl-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 13px; }
.vb-wl-add { display: flex; gap: 10px; margin-top: 14px; }
.vb-wl-add input { flex: 1; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); border-radius: 6px; color: inherit; padding: 6px 10px; font-size: 13px; }
.vb-legend { display: flex; gap: 18px; font-size: 12px; opacity: .7; margin-top: 8px; }
.vb-dot { display: inline-block; width: 10px; height: 10px; border-radius: 5px; margin-right: 5px; vertical-align: -1px; }
`;

function vbRead(key, fallback) {
  try {
    return JSON.parse(Spicetify.LocalStorage.get(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function VerifiedBlocksApp() {
  const { useState, useEffect, createElement: h } = Spicetify.React;

  const load = () => ({
    stats: vbRead('verifiedOnly:stats', { plays: 0, blocks: 0, byArtist: {} }),
    events: vbRead('verifiedOnly:events', []),
    allowed: vbRead('verifiedOnly:allowed', {}),
  });

  const [data, setData] = useState(load);
  const [addValue, setAddValue] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const saveAllowed = (next) => {
    Spicetify.LocalStorage.set('verifiedOnly:allowed', JSON.stringify(next));
    setData(load());
  };
  const allowArtist = (uri, name) => {
    saveAllowed({ ...data.allowed, [uri]: name ?? uri });
    Spicetify.showNotification(`${name ?? uri} allowed - won't be blocked anymore`);
  };
  const removeArtist = (uri) => {
    const name = data.allowed[uri];
    const next = { ...data.allowed };
    delete next[uri];
    saveAllowed(next);
    Spicetify.showNotification(`${name ?? uri} no longer allowed`);
  };

  async function addByLink() {
    const m = addValue.match(/artist[/:]([A-Za-z0-9]{22})/);
    if (!m) {
      Spicetify.showNotification('Paste a Spotify artist link or URI');
      return;
    }
    const uri = 'spotify:artist:' + m[1];
    setAddBusy(true);
    try {
      const res = await Spicetify.GraphQL.Request(
        Spicetify.GraphQL.Definitions.queryArtistOverview,
        { uri, locale: '', includePrerelease: false, enableAssociatedVideos: false }
      );
      const name = res?.data?.artistUnion?.profile?.name;
      allowArtist(uri, name);
      setAddValue('');
    } catch {
      Spicetify.showNotification('Could not look up that artist');
    }
    setAddBusy(false);
  }

  useEffect(() => {
    const id = setInterval(() => setData(load()), 5000);
    return () => clearInterval(id);
  }, []);

  const { stats, events, allowed } = data;
  const allowedEntries = Object.entries(allowed).sort((a, b) => a[1].localeCompare(b[1]));
  const total = stats.plays + stats.blocks;
  const rate = total ? ((stats.blocks / total) * 100).toFixed(1) : '0.0';

  // daily buckets for the last 7 calendar days, today last
  const now = Date.now();
  const dayMs = 24 * 3600e3;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const start = todayStart.getTime() - (6 - i) * dayMs;
    return { start, plays: 0, blocks: 0 };
  });
  for (const e of events) {
    if (e.t < buckets[0].start) continue;
    const idx = Math.min(6, Math.floor((e.t - buckets[0].start) / dayMs));
    if (e.y === 'play') buckets[idx].plays++;
    else buckets[idx].blocks++;
  }
  const maxBucket = Math.max(1, ...buckets.map(b => b.plays + b.blocks));

  const topBlocked = Object.entries(stats.byArtist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxArtist = topBlocked.length ? topBlocked[0][1] : 1;

  const recentBlocks = events.filter(e => e.y !== 'play').slice(-25).reverse();

  const card = (cls, num, label) =>
    h('div', { className: 'vb-card ' + cls },
      h('div', { className: 'vb-num' }, num),
      h('div', { className: 'vb-label' }, label));

  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDay = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const W = 720, H = 150, chartH = H - 24, bw = W / 7;
  const chartBars = [];
  buckets.forEach((b, i) => {
    const total = b.plays + b.blocks;
    const totalH = (total / maxBucket) * (chartH - 14);
    const blockH = (b.blocks / maxBucket) * (chartH - 14);
    chartBars.push(h('rect', {
      key: 'p' + i, x: i * bw + 18, y: chartH - totalH, width: bw - 36,
      height: Math.max(0, totalH - blockH), fill: '#00a65a', rx: 3,
    }));
    if (blockH > 0) chartBars.push(h('rect', {
      key: 'b' + i, x: i * bw + 18, y: chartH - blockH, width: bw - 36,
      height: blockH, fill: '#dd4b39', rx: 3,
    }));
    if (total > 0) chartBars.push(h('text', {
      key: 'c' + i, x: i * bw + bw / 2, y: chartH - totalH - 4,
      'text-anchor': 'middle', fill: 'currentColor', opacity: 0.6, 'font-size': 11,
    }, String(total)));
    chartBars.push(h('text', {
      key: 'd' + i, x: i * bw + bw / 2, y: H - 6,
      'text-anchor': 'middle', fill: 'currentColor', opacity: 0.5, 'font-size': 11,
    }, fmtDay(b.start)));
  });

  return h('div', { className: 'vb-root' },
    h('style', null, VB_CSS),
    h('h1', null, 'Verified Blocks'),
    h('div', { className: 'vb-sub' }, 'Tracks from artists without the "Verified by Spotify" badge are skipped or removed from the queue.'),

    h('div', { className: 'vb-cards' },
      card('vb-green', stats.plays.toLocaleString(), 'Tracks played'),
      card('vb-red', stats.blocks.toLocaleString(), 'Tracks blocked'),
      card('vb-orange', rate + ' %', 'Block rate'),
      card('vb-blue', Object.keys(stats.byArtist).length.toLocaleString(), 'Artists blocked')),

    h('div', { className: 'vb-panel' },
      h('h2', null, 'Last 7 days'),
      h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%', height: '150px', display: 'block' } }, chartBars),
      h('div', { className: 'vb-legend' },
        h('span', null, h('span', { className: 'vb-dot', style: { background: '#00a65a' } }), 'Played'),
        h('span', null, h('span', { className: 'vb-dot', style: { background: '#dd4b39' } }), 'Blocked'),
        h('span', { style: { marginLeft: 'auto' } }, 'Updated ' + fmtTime(now)))),

    h('div', { className: 'vb-panel' },
      h('h2', null, 'Top blocked artists'),
      topBlocked.length === 0
        ? h('div', { className: 'vb-empty' }, 'Nothing blocked yet.')
        : topBlocked.map(([name, count]) =>
            h('div', { className: 'vb-barrow', key: name },
              h('span', { className: 'vb-name' }, name),
              h('div', { className: 'vb-bar' }, h('div', { style: { width: (count / maxArtist) * 100 + '%' } })),
              h('span', null, count)))),

    h('div', { className: 'vb-panel' },
      h('h2', null, 'Recent blocks'),
      recentBlocks.length === 0
        ? h('div', { className: 'vb-empty' }, 'Nothing blocked yet.')
        : h('table', { className: 'vb-table' },
            h('thead', null, h('tr', null,
              h('th', null, 'When'), h('th', null, 'Action'), h('th', null, 'Track'), h('th', null, 'Artist'), h('th', null, ''))),
            h('tbody', null, recentBlocks.map((e, i) =>
              h('tr', { key: i },
                h('td', null, fmtDay(e.t) + ' ' + fmtTime(e.t)),
                h('td', null, h('span', { className: 'vb-badge ' + (e.y === 'skip' ? 'vb-badge-skip' : 'vb-badge-prune') },
                  e.y === 'skip' ? 'SKIPPED' : 'DEQUEUED')),
                h('td', null, e.tr ?? '-'),
                h('td', null, e.ar ?? '-'),
                h('td', null, !e.au ? null : allowed[e.au]
                  ? h('button', { className: 'vb-btn vb-btn-ghost', onClick: () => removeArtist(e.au) }, 'Disallow')
                  : h('button', { className: 'vb-btn', onClick: () => allowArtist(e.au, e.ar) }, 'Allow'))))))),

    h('div', { className: 'vb-panel' },
      h('h2', null, 'Allowed artists'),
      h('div', { className: 'vb-sub', style: { marginBottom: '10px' } },
        'Allowed artists are never blocked, even without the Verified badge - for real artists the badge has missed.'),
      allowedEntries.length === 0
        ? h('div', { className: 'vb-empty' }, 'No allowed artists. Use "Allow" on a recent block, or paste an artist link below.')
        : allowedEntries.map(([uri, name]) =>
            h('div', { className: 'vb-wl-row', key: uri },
              h('span', { className: 'vb-name', style: { flex: 1 } }, name),
              h('button', { className: 'vb-btn vb-btn-danger', onClick: () => removeArtist(uri) }, 'Remove'))),
      h('div', { className: 'vb-wl-add' },
        h('input', {
          className: 'vb-wl-input',
          placeholder: 'https://open.spotify.com/artist/… or spotify:artist:…',
          value: addValue,
          onChange: (e) => setAddValue(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') addByLink(); },
        }),
        h('button', { className: 'vb-btn vb-wl-addbtn', disabled: addBusy, onClick: addByLink }, addBusy ? '…' : 'Add'))));
}
