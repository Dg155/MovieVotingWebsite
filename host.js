(function () {
  'use strict';
  /* ── State ──────────────────────────────────────────── */
  let movies = [];
  let peer = null;
  let conns = {};      // peerId → { conn, name, voted, votes }
  let roomCode = '';
  /* ── Helpers ────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function genRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
  function getBaseUrl() {
    let p = window.location.pathname;
    if (p.endsWith('.html')) p = p.substring(0, p.lastIndexOf('/') + 1);
    else if (!p.endsWith('/')) p += '/';
    return window.location.origin + p;
  }
  function showPhase(id) {
    document.querySelectorAll('.phase').forEach((el) => el.classList.remove('active'));
    $(id).classList.add('active');
  }
  /* ── Movie Management ───────────────────────────────── */
  function addMovie(data) {
    data.id = uid();
    movies.push(data);
    renderSetupMovies();
    updateStartBtn();
  }
  function removeMovie(id) {
    movies = movies.filter((m) => m.id !== id);
    renderSetupMovies();
    updateStartBtn();
  }
  function movieCardHTML(m, removable) {
    const meta = [
      m.director && `🎬 ${m.director}`,
      m.genre    && `🎭 ${m.genre}`,
      m.runtime  && `⏱ ${m.runtime}`,
      m.year     && `📅 ${m.year}`,
    ].filter(Boolean);
    return `
      <div class="movie-card" data-id="${m.id}">
        <div class="m-poster">
          ${m.poster
            ? `<img src="${esc(m.poster)}" alt="" onerror="this.parentElement.innerHTML='🎬'">`
            : '🎬'}
        </div>
        <div class="m-info">
          <h3>${esc(m.title)}</h3>
          ${meta.length ? `<div class="m-meta">${meta.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
          ${m.description ? `<p class="m-desc">${esc(m.description)}</p>` : ''}
        </div>
        ${removable ? `<button class="m-remove" data-remove="${m.id}">&times;</button>` : ''}
      </div>`;
  }
  function renderSetupMovies() {
    const el = $('movies-list');
    if (!movies.length) { el.innerHTML = ''; return; }
    el.innerHTML = movies.map((m) => movieCardHTML(m, true)).join('');
    el.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => removeMovie(btn.dataset.remove));
    });
  }
  function updateStartBtn() {
    $('btn-start').disabled = movies.length < 2;
  }
  /* ── Session / PeerJS ───────────────────────────────── */
  function startSession() {
    roomCode = genRoomCode();
    $('btn-start').disabled = true;
    $('btn-start').textContent = 'Connecting…';
    peer = new Peer('mn-' + roomCode, { debug: 0 });
    peer.on('open', () => {
      showPhase('phase-lobby');
      setupLobby();
    });
    peer.on('connection', handleConnection);
    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'unavailable-id') {
        peer.destroy();
        startSession();                     // retry with new code
      } else {
        $('btn-start').textContent = 'Error — Retry';
        $('btn-start').disabled = false;
      }
    });
  }
  function setupLobby() {
    const voteUrl = getBaseUrl() + 'vote.html?room=' + roomCode;
    // QR code via public API
    $('qr-img').src =
      'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' +
      encodeURIComponent(voteUrl);
    $('disp-room').textContent = roomCode;
    $('disp-url').textContent = voteUrl;
    // Copy link
    $('btn-copy').onclick = () => {
      navigator.clipboard.writeText(voteUrl).then(() => {
        $('btn-copy').textContent = '✓ Copied!';
        setTimeout(() => ($('btn-copy').textContent = '📋 Copy Link'), 2000);
      });
    };
    // Show movie list in lobby
    $('lobby-movies').innerHTML = movies.map((m) => movieCardHTML(m, false)).join('');
  }
  function handleConnection(conn) {
    conn.on('open', () => {
      // Send movie data to the voter
      conn.send({
        type: 'movieList',
        movies: movies,
        totalPoints: movies.length,
      });
    });
    conn.on('data', (data) => {
      if (data.type === 'join') {
        // Allow reconnection with same name
        const dup = Object.entries(conns).find(([, v]) => v.name === data.name);
        if (dup) delete conns[dup[0]];
        conns[conn.peer] = { conn, name: data.name, voted: false, votes: {} };
        renderVoters();
      }
      if (data.type === 'vote' && conns[conn.peer]) {
        conns[conn.peer].voted = true;
        conns[conn.peer].votes = data.votes;
        renderVoters();
        updateRevealBtn();
      }
    });
    conn.on('close', () => {
      if (conns[conn.peer]) {
        conns[conn.peer].disconnected = true;
        renderVoters();
      }
    });
  }
  /* ── Voter List UI ──────────────────────────────────── */
  function renderVoters() {
    const entries = Object.values(conns);
    $('voter-count').textContent = entries.length;
    if (!entries.length) {
      $('voters-list').innerHTML =
        '<p class="muted center-text">Waiting for voters to join…</p>';
      return;
    }
    $('voters-list').innerHTML =
      '<div class="voter-chips">' +
      entries
        .map(
          (v) =>
            `<span class="voter-chip${v.voted ? ' voted' : ''}">` +
            `<span class="dot"></span>${esc(v.name)}${v.voted ? ' ✓' : ''}</span>`
        )
        .join('') +
      '</div>';
  }
  function updateRevealBtn() {
    const votedCount = Object.values(conns).filter((v) => v.voted).length;
    $('btn-reveal').disabled = votedCount === 0;
    $('btn-reveal').textContent =
      `🎉 Reveal Results (${votedCount} vote${votedCount !== 1 ? 's' : ''})`;
  }
  /* ── Results ────────────────────────────────────────── */
  function revealResults() {
    // Tally points
    const totals = {};
    movies.forEach((m) => (totals[m.id] = 0));
    Object.values(conns).forEach((v) => {
      if (!v.voted || !v.votes) return;
      Object.entries(v.votes).forEach(([mid, pts]) => {
        if (totals[mid] !== undefined) totals[mid] += pts;
      });
    });
    const maxPts = Math.max(...Object.values(totals), 0);
    const winnerIds = Object.keys(totals).filter(
      (id) => totals[id] === maxPts && maxPts > 0
    );
    // Broadcast results to all voters
    const payload = { type: 'results', totals, winnerIds, movies };
    Object.values(conns).forEach((v) => {
      try { if (v.conn.open) v.conn.send(payload); } catch (e) { /* ignore */ }
    });
    // Render locally
    renderResults(totals, winnerIds, maxPts);
    showPhase('phase-results');
  }
  function renderResults(totals, winnerIds, maxPts) {
    // Winner banner
    const banner = $('winner-banner');
    if (winnerIds.length === 1) {
      const w = movies.find((m) => m.id === winnerIds[0]);
      banner.innerHTML =
        `<div class="trophy">🏆</div>` +
        `<h2>${esc(w.title)}</h2>` +
        `<p>${totals[w.id]} point${totals[w.id] !== 1 ? 's' : ''}</p>`;
    } else if (winnerIds.length > 1) {
      const names = winnerIds.map((id) => movies.find((m) => m.id === id).title);
      banner.innerHTML =
        `<div class="trophy">🏆</div>` +
        `<h2>It's a tie!</h2>` +
        `<p>${names.map((n) => esc(n)).join(' &amp; ')} — ${maxPts} pts each</p>`;
    } else {
      banner.innerHTML =
        `<div class="trophy">🤷</div><h2>No votes yet</h2>`;
    }
    // Bar chart (sorted by points descending)
    const sorted = movies.slice().sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0));
    $('results-bars').innerHTML = sorted
      .map((m) => {
        const pts = totals[m.id] || 0;
        const pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;
        const isW = winnerIds.includes(m.id);
        return `
          <div class="result-bar${isW ? ' is-winner' : ''}">
            <div class="result-fill" data-w="${pct}"></div>
            <div class="result-inner">
              <span class="title">${isW ? '👑 ' : ''}${esc(m.title)}</span>
              <span class="pts">${pts} pt${pts !== 1 ? 's' : ''}</span>
            </div>
          </div>`;
      })
      .join('');
    // Animate bars in
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('#results-bars .result-fill').forEach((el) => {
          el.style.width = el.dataset.w + '%';
        });
      }, 100);
    });
  }
  /* ── Event Listeners ────────────────────────────────── */
  // Add movie form
  $('movie-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('inp-title').value.trim();
    if (!title) return;
    addMovie({
      title,
      director:    $('inp-director').value.trim(),
      genre:       $('inp-genre').value.trim(),
      runtime:     $('inp-runtime').value.trim(),
      year:        $('inp-year').value.trim(),
      description: $('inp-desc').value.trim(),
      poster:      $('inp-poster').value.trim(),
    });
    $('movie-form').reset();
    $('inp-title').focus();
  });
  // Start session
  $('btn-start').addEventListener('click', startSession);
  // Reveal results
  $('btn-reveal').addEventListener('click', revealResults);
  // New session
  $('btn-reset').addEventListener('click', () => {
    if (peer) { peer.destroy(); peer = null; }
    conns = {};
    movies = [];
    renderSetupMovies();
    updateStartBtn();
    $('btn-start').textContent = 'Start Voting Session';
    $('btn-start').disabled = true;
    showPhase('phase-setup');
  });
})();