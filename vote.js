(function () {
  'use strict';
  /* ── State ──────────────────────────────────────────── */
  let peer = null;
  let conn = null;
  let movies = [];
  let totalPoints = 0;
  let allocated = {};   // movieId → points
  let voterName = '';
  let currentState = 'state-name';
  /* ── Helpers ────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
  function showState(id) {
    currentState = id;
    document.querySelectorAll('.phase').forEach((el) => el.classList.remove('active'));
    $(id).classList.add('active');
  }
  /* ── Room code from URL ─────────────────────────────── */
  const params = new URLSearchParams(window.location.search);
  let roomCode = (params.get('room') || '').toUpperCase().trim();
  // If no room code in URL, show the room-code input field
  if (!roomCode) {
    $('room-input-group').style.display = 'block';
  }
  /* ── Join-button enable/disable ─────────────────────── */
  function checkJoinReady() {
    const name = $('inp-name').value.trim();
    const room = roomCode || ($('inp-room') ? $('inp-room').value.trim() : '');
    $('btn-join').disabled = !name || !room;
  }
  $('inp-name').addEventListener('input', checkJoinReady);
  if ($('inp-room')) $('inp-room').addEventListener('input', checkJoinReady);
  // Enter key
  $('inp-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join').click();
  });
  if ($('inp-room')) {
    $('inp-room').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btn-join').click();
    });
  }
  /* ── Join Session ───────────────────────────────────── */
  $('btn-join').addEventListener('click', () => {
    voterName = $('inp-name').value.trim();
    const code = roomCode || ($('inp-room') ? $('inp-room').value.trim().toUpperCase() : '');
    if (!voterName || !code) return;
    roomCode = code;
    connectToHost();
  });
  function connectToHost() {
    showState('state-connecting');
    peer = new Peer(undefined, { debug: 0 });
    peer.on('open', () => {
      conn = peer.connect('mn-' + roomCode, { reliable: true });
      let opened = false;
      conn.on('open', () => {
        opened = true;
        conn.send({ type: 'join', name: voterName });
      });
      conn.on('data', (data) => {
        if (data.type === 'movieList') {
          movies = data.movies;
          totalPoints = data.totalPoints;
          setupVoting();
        }
        if (data.type === 'results') {
          showResults(data);
        }
      });
      conn.on('close', () => {
        if (!movies.length) {
          $('error-msg').textContent = 'Connection to host was lost before receiving data.';
          showState('state-error');
        }
        // If already submitted, we just wait — they can look at the host screen
      });
      conn.on('error', (err) => {
        console.error('Connection error:', err);
        $('error-msg').textContent = 'Could not connect. Check the room code and try again.';
        showState('state-error');
      });
      // Timeout if connection never opens
      setTimeout(() => {
        if (!opened) {
          $('error-msg').textContent =
            'Connection timed out. Make sure the host session is running.';
          showState('state-error');
          try { peer.destroy(); } catch (e) { /* ignore */ }
        }
      }, 15000);
    });
    peer.on('error', (err) => {
      console.error('Peer error:', err);
      $('error-msg').textContent = 'Network error: ' + (err.type || err.message);
      showState('state-error');
    });
  }
  /* ── Voting UI ──────────────────────────────────────── */
  function setupVoting() {
    $('greeting').textContent = `${voterName}, distribute your ${totalPoints} points`;
    $('pts-remaining').textContent = totalPoints;
    movies.forEach((m) => (allocated[m.id] = 0));
    const container = $('vote-movies');
    container.innerHTML = movies
      .map((m) => {
        const meta = [
          m.director && `🎬 ${m.director}`,
          m.genre    && `🎭 ${m.genre}`,
          m.runtime  && `⏱ ${m.runtime}`,
          m.year     && `📅 ${m.year}`,
        ].filter(Boolean);
        return `
          <div class="vote-card" data-id="${m.id}">
            <h3>${esc(m.title)}</h3>
            ${meta.length
              ? `<div class="v-meta">${meta.map((t) => `<span>${esc(t)}</span>`).join('')}</div>`
              : ''}
            ${m.description ? `<p class="v-desc">${esc(m.description)}</p>` : ''}
            <div class="pt-controls">
              <button class="pt-minus" data-mid="${m.id}" aria-label="Remove point">−</button>
              <span class="pv" id="pv-${m.id}">0</span>
              <button class="pt-plus" data-mid="${m.id}" aria-label="Add point">+</button>
            </div>
          </div>`;
      })
      .join('');
    // Event delegation for point buttons
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !btn.dataset.mid) return;
      const delta = btn.classList.contains('pt-plus') ? 1 : -1;
      adjustPoint(btn.dataset.mid, delta);
    });
    updatePointsUI();
    showState('state-voting');
  }
  function adjustPoint(mid, delta) {
    const cur = allocated[mid];
    const remaining = getRemaining();
    if (delta < 0 && cur <= 0) return;
    if (delta > 0 && remaining <= 0) return;
    allocated[mid] = cur + delta;
    $('pv-' + mid).textContent = allocated[mid];
    // Quick scale animation on the number
    const el = $('pv-' + mid);
    el.style.transform = 'scale(1.25)';
    setTimeout(() => (el.style.transform = 'scale(1)'), 120);
    updatePointsUI();
  }
  function getRemaining() {
    const used = Object.values(allocated).reduce((a, b) => a + b, 0);
    return totalPoints - used;
  }
  function updatePointsUI() {
    const remaining = getRemaining();
    const used = totalPoints - remaining;
    $('pts-remaining').textContent = remaining;
    // Colour the remaining count
    $('pts-remaining').style.color =
      remaining === 0 ? '#3fb950' : 'var(--gold)';
    // Enable/disable individual buttons
    movies.forEach((m) => {
      const minus = document.querySelector(`.pt-minus[data-mid="${m.id}"]`);
      const plus  = document.querySelector(`.pt-plus[data-mid="${m.id}"]`);
      if (minus) minus.disabled = allocated[m.id] <= 0;
      if (plus)  plus.disabled  = remaining <= 0;
    });
    // Submit requires at least 1 point allocated
    $('btn-submit').disabled = used === 0;
  }
  /* ── Submit Vote ────────────────────────────────────── */
  $('btn-submit').addEventListener('click', () => {
    if (!conn || !conn.open) {
      $('error-msg').textContent = 'Lost connection to host. Please refresh and try again.';
      showState('state-error');
      return;
    }
    conn.send({ type: 'vote', votes: { ...allocated } });
    showState('state-submitted');
  });
  /* ── Show Results ───────────────────────────────────── */
  function showResults(data) {
    const { totals, winnerIds, movies: movieList } = data;
    const maxPts = Math.max(...Object.values(totals), 0);
    // Winner banner
    const banner = $('voter-winner');
    if (winnerIds.length === 1) {
      const w = movieList.find((m) => m.id === winnerIds[0]);
      banner.innerHTML =
        `<div class="trophy">🏆</div>` +
        `<h2>${esc(w.title)}</h2>` +
        `<p>${totals[w.id]} point${totals[w.id] !== 1 ? 's' : ''}</p>`;
    } else if (winnerIds.length > 1) {
      const names = winnerIds.map((id) => movieList.find((m) => m.id === id).title);
      banner.innerHTML =
        `<div class="trophy">🏆</div>` +
        `<h2>It's a tie!</h2>` +
        `<p>${names.map((n) => esc(n)).join(' &amp; ')} — ${maxPts} pts each</p>`;
    }
    // Result bars
    const sorted = movieList
      .slice()
      .sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0));
    $('voter-results-bars').innerHTML = sorted
      .map((m) => {
        const pts = totals[m.id] || 0;
        const pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;
        const isW = winnerIds.includes(m.id);
        return `
          <div class="result-bar${isW ? ' is-winner' : ''}">
            <div class="result-fill" style="width:${pct}%"></div>
            <div class="result-inner">
              <span class="title">${isW ? '👑 ' : ''}${esc(m.title)}</span>
              <span class="pts">${pts} pt${pts !== 1 ? 's' : ''}</span>
            </div>
          </div>`;
      })
      .join('');
    showState('state-results');
  }
})();