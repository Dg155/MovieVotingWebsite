(function () {
  'use strict';
  const PRESET_URL = 'movies.json';
  const DRAFT_KEY  = 'mn:lineup:v1';
  let movies   = [];
  let peer     = null;
  let conns    = {};   // peerId -> { conn, name, voted, votes }
  let roomCode = '';
  /* ===================================================
     BOOT
     =================================================== */
  window.addEventListener('DOMContentLoaded', init);
  async function init() {
    bindEvents();
    const draft = loadDraft();
    if (draft && draft.length) {
      movies = draft;
      renderLineup();
    } else {
      await loadPresets();
    }
    updateStartBtn();
  }
  /* ===================================================
     PRESETS / DRAFT
     =================================================== */
  async function loadPresets() {
    try {
      const res = await fetch(PRESET_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.movies || []);
      movies = list.map(normalize);
      saveDraft();
      hideNotice();
    } catch (err) {
      console.warn('[movies.json]', err);
      movies = [];
      showNotice(
        `Couldn't load <code>movies.json</code> (${esc(err.message)}).<br>` +
        `If you opened this file directly from disk, run a local server ` +
        `(<code>npx serve</code> or <code>python -m http.server</code>). ` +
        `GitHub Pages works out of the box. You can still add movies manually.`
      );
    }
    renderLineup();
    updateStartBtn();
  }
  function normalize(m) {
    return {
      id:          uid(),
      title:       (m.title || 'Untitled').trim(),
      year:        (m.year || '').toString().trim(),
      director:    (m.director || '').trim(),
      genre:       (m.genre || '').trim(),
      runtime:     (m.runtime || '').trim(),
      description: (m.description || '').trim(),
      poster:      (m.poster || '').trim(),
    };
  }
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(movies)); } catch (e) {}
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function showNotice(html) {
    const n = $('#notice');
    n.innerHTML = html;
    n.classList.remove('hidden');
  }
  function hideNotice() { $('#notice').classList.add('hidden'); }
  /* ===================================================
     LINEUP RENDERING
     =================================================== */
  function metaBar(m) {
    const items = [
      ['Director', m.director],
      ['Runtime',  m.runtime],
      ['Year',     m.year],
    ].filter(([, v]) => v);
    if (!items.length) return '';
    return `<div class="meta-bar">${items
      .map(([label, value]) => `
        <div class="meta-item">
          <span class="meta-label">${label}</span>
          <span class="meta-value">${esc(value)}</span>
        </div>`)
      .join('')}</div>`;
  }
  function movieCardHTML(m, { removable = false, index = 0 } = {}) {
    const reverse = index % 2 === 1 ? ' reverse' : '';
    const delay   = 'delay-' + Math.min((index % 5) + 1, 5);
    return `
      <article class="movie-card reveal reveal-up ${delay}${reverse}" data-id="${m.id}">
        <div class="movie-poster">
          ${posterHTML(m.poster)}
          <span class="poster-rank">#${index + 1}</span>
        </div>
        <div class="movie-body">
          <h3>${esc(m.title)}</h3>
          ${m.genre ? `<p class="movie-tagline">${esc(m.genre)}</p>` : ''}
          ${metaBar(m)}
          ${m.description ? `<p class="movie-desc">${esc(m.description)}</p>` : ''}
        </div>
        ${removable
          ? `<button class="movie-remove" data-remove="${m.id}" aria-label="Remove">&times;</button>`
          : ''}
      </article>`;
  }
  function renderLineup() {
    const host = $('#lineup');
    $('#lineup-count').textContent = movies.length ? `(${movies.length})` : '';
    $('#points-note').textContent  = movies.length
      ? `Each voter receives ${movies.length} points`
      : '';
    if (!movies.length) {
      host.innerHTML = `<div class="empty-lineup reveal reveal-up">
        Nothing on the ballot yet — add a movie or reset to presets.
      </div>`;
      initReveals(host);
      return;
    }
    host.innerHTML = movies
      .map((m, i) => movieCardHTML(m, { removable: true, index: i }))
      .join('');
    $$('[data-remove]', host).forEach((btn) =>
      btn.addEventListener('click', () => removeMovie(btn.dataset.remove))
    );
    initReveals(host);
  }
  function addMovie(data) {
    movies.push(normalize(data));
    saveDraft();
    renderLineup();
    updateStartBtn();
  }
  function removeMovie(id) {
    movies = movies.filter((m) => m.id !== id);
    saveDraft();
    renderLineup();
    updateStartBtn();
  }
  function updateStartBtn() {
    const ok = movies.length >= 2;
    $('#btn-start').disabled = !ok;
    $('#btn-start span').textContent = ok
      ? `Start Voting Session · ${movies.length} Points Each`
      : 'Add at least 2 movies';
  }
  /* ===================================================
     PHASE + NAV
     =================================================== */
  function showPhase(id) {
    $$('.phase').forEach((p) => p.classList.remove('active'));
    $('#' + id).classList.add('active');
    $$('.nav-step').forEach((s) =>
      s.classList.toggle('active', s.dataset.step === id)
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initReveals(document);
  }
  /* ===================================================
     SESSION (PeerJS)
     =================================================== */
  function genRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function getBaseUrl() {
    let p = window.location.pathname;
    if (p.endsWith('.html'))      p = p.slice(0, p.lastIndexOf('/') + 1);
    else if (!p.endsWith('/'))    p += '/';
    return window.location.origin + p;
  }
  function startSession() {
    roomCode = genRoomCode();
    $('#btn-start').disabled = true;
    $('#btn-start span').textContent = 'Connecting…';
    peer = new Peer('mn-' + roomCode, { debug: 0 });
    peer.on('open', () => {
      showPhase('phase-lobby');
      setupLobby();
    });
    peer.on('connection', handleConnection);
    peer.on('error', (err) => {
      console.error('[peer]', err);
      if (err.type === 'unavailable-id') {
        peer.destroy();
        startSession();                 // collision — try another code
      } else {
        $('#btn-start span').textContent = 'Error — Retry';
        $('#btn-start').disabled = false;
      }
    });
  }
  function setupLobby() {
    const voteUrl = getBaseUrl() + 'vote.html?room=' + roomCode;
    $('#qr-img').src =
      'https://api.qrserver.com/v1/create-qr-code/?size=230x230&margin=6&data=' +
      encodeURIComponent(voteUrl);
    $('#disp-room').textContent = roomCode;
    $('#disp-url').textContent  = voteUrl;
    $('#lobby-points-note').textContent = `${movies.length} points per voter`;
    $('#lobby-movies').innerHTML = movies
      .map((m, i) => movieCardHTML(m, { index: i }))
      .join('');
    $('#btn-copy').onclick = () => {
      navigator.clipboard.writeText(voteUrl).then(() => {
        const s = $('#btn-copy span');
        s.textContent = '✓ Copied';
        setTimeout(() => (s.textContent = '📋 Copy Link'), 1800);
      });
    };
    initReveals(document);
  }
  function handleConnection(conn) {
    conn.on('open', () => {
      conn.send({ type: 'movieList', movies, totalPoints: movies.length });
    });
    conn.on('data', (data) => {
      if (data.type === 'join') {
        // same name rejoining? drop the stale record
        const dup = Object.entries(conns).find(([, v]) => v.name === data.name);
        if (dup) delete conns[dup[0]];
        conns[conn.peer] = { conn, name: data.name, voted: false, votes: {} };
        renderVoters();
      }
      if (data.type === 'vote' && conns[conn.peer]) {
        conns[conn.peer].voted = true;
        conns[conn.peer].votes = data.votes;
        renderVoters();
      }
    });
    conn.on('close', () => {
      if (conns[conn.peer]) conns[conn.peer].disconnected = true;
      renderVoters();
    });
  }
  function renderVoters() {
    const list  = Object.values(conns);
    const voted = list.filter((v) => v.voted).length;
    $('#voter-count').textContent = `(${list.length})`;
    $('#voted-note').textContent  = list.length
      ? `${voted} of ${list.length} ballots cast`
      : 'Waiting for the first ballot';
    $('#voters-list').innerHTML = list.length
      ? `<div class="chips">${list
          .map((v) => `<span class="chip${v.voted ? ' voted' : ''}">
              <span class="dot"></span>${esc(v.name)}${v.voted ? ' ✓' : ''}
            </span>`)
          .join('')}</div>`
      : `<p class="muted center" style="letter-spacing:1px">No one has joined yet…</p>`;
    $('#btn-reveal').disabled = voted === 0;
    $('#btn-reveal span').textContent = voted
      ? `🏆 Reveal Results · ${voted} Ballot${voted !== 1 ? 's' : ''}`
      : '🏆 Reveal Results';
  }
  /* ===================================================
     RESULTS
     =================================================== */
  function tally() {
    const totals  = {};
    const backers = {};
    movies.forEach((m) => { totals[m.id] = 0; backers[m.id] = 0; });
    const ballots = Object.values(conns).filter((v) => v.voted);
    ballots.forEach((v) => {
      Object.entries(v.votes || {}).forEach(([mid, pts]) => {
        if (totals[mid] === undefined) return;
        totals[mid]  += pts;
        if (pts > 0) backers[mid] += 1;
      });
    });
    const pot       = Object.values(totals).reduce((a, b) => a + b, 0);
    const maxPts    = Math.max(...Object.values(totals), 0);
    const winnerIds = Object.keys(totals).filter((id) => totals[id] === maxPts && maxPts > 0);
    return { totals, backers, pot, maxPts, winnerIds, voterCount: ballots.length };
  }
  function revealResults() {
    const r = tally();
    const payload = { type: 'results', movies, ...r };
    Object.values(conns).forEach((v) => {
      try { if (v.conn.open) v.conn.send(payload); } catch (e) {}
    });
    renderResults(payload);
    showPhase('phase-results');
  }
  function renderResults(r) {
    $('#winner-panel').innerHTML = winnerHTML(r);
    $('#results-bars').innerHTML = barsHTML(r);
    requestAnimationFrame(() =>
      setTimeout(() => {
        $$('#results-bars .result-fill').forEach((el) => (el.style.width = el.dataset.w + '%'));
      }, 220)
    );
    initReveals(document);
  }
  /* ===================================================
     EVENTS
     =================================================== */
  function bindEvents() {
    $('#movie-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = $('#inp-title').value.trim();
      if (!title) return;
      addMovie({
        title,
        year:        $('#inp-year').value,
        director:    $('#inp-director').value,
        genre:       $('#inp-genre').value,
        runtime:     $('#inp-runtime').value,
        description: $('#inp-desc').value,
        poster:      $('#inp-poster').value,
      });
      e.target.reset();
      $('#inp-title').focus();
    });
    $('#btn-presets').addEventListener('click', async () => {
      localStorage.removeItem(DRAFT_KEY);
      await loadPresets();
    });
    $('#btn-clear').addEventListener('click', () => {
      movies = [];
      saveDraft();
      renderLineup();
      updateStartBtn();
    });
    $('#btn-start').addEventListener('click', startSession);
    $('#btn-reveal').addEventListener('click', revealResults);
    $('#btn-reset').addEventListener('click', () => {
      if (peer) { peer.destroy(); peer = null; }
      conns = {};
      roomCode = '';
      updateStartBtn();
      renderLineup();
      showPhase('phase-setup');
    });
  }
  /* ===================================================
     SHARED RESULT MARKUP (also used by vote.js)
     =================================================== */
  window.winnerHTML = function (r) {
    const { movies: list, totals, maxPts, winnerIds, voterCount } = r;
    if (!winnerIds.length) {
      return `<div class="trophy">🤷</div><h2>No Votes Cast</h2>`;
    }
    if (winnerIds.length === 1) {
      const w = list.find((m) => m.id === winnerIds[0]);
      return `
        <div class="trophy">🏆</div>
        <h2>${esc(w.title)}</h2>
        <p class="winner-sub">${totals[w.id]} points · ${voterCount} ballot${voterCount !== 1 ? 's' : ''}</p>`;
    }
    const names = winnerIds.map((id) => list.find((m) => m.id === id).title);
    return `
      <div class="trophy">🤝</div>
      <h2>It's a Tie</h2>
      <p class="winner-sub">${names.map(esc).join(' &amp; ')} — ${maxPts} pts each</p>`;
  };
  window.barsHTML = function (r, animate = true) {
    const { movies: list, totals, backers, pot, maxPts, winnerIds, voterCount } = r;
    return list
      .slice()
      .sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0))
      .map((m, i) => {
        const pts   = totals[m.id] || 0;
        const width = maxPts > 0 ? (pts / maxPts) * 100 : 0;
        const share = pot > 0 ? Math.round((pts / pot) * 100) : 0;
        const win   = winnerIds.includes(m.id);
        const delay = 'delay-' + Math.min(i + 1, 5);
        const fill = animate
          ? `<div class="result-fill" data-w="${width}"></div>`
          : `<div class="result-fill" style="width:${width}%"></div>`;
        return `
          <div class="result-row${win ? ' winner' : ''} reveal reveal-up ${delay}">
            ${fill}
            <div class="result-inner">
              <span class="result-title">${win ? '👑 ' : ''}${esc(m.title)}</span>
              <span class="result-pts">${pts} pt${pts !== 1 ? 's' : ''}</span>
            </div>
            <p class="result-breakdown">
              ${share}% of the pot · backed by ${backers[m.id] || 0}/${voterCount}
            </p>
          </div>`;
      })
      .join('');
  };
})();