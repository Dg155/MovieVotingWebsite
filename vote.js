(function () {
  'use strict';
  let peer = null, conn = null;
  let movies = [], allocated = {}, totalPoints = 0;
  let voterName = '', roomCode = '';
  /* ---------- boot ---------- */
  window.addEventListener('DOMContentLoaded', () => {
    roomCode = (new URLSearchParams(location.search).get('room') || '')
      .toUpperCase().trim();
    if (roomCode) {
      $('#nav-room').textContent = 'Room ' + roomCode;
    } else {
      $('#room-field').hidden = false;
      $('#nav-room').textContent = 'Room —';
    }
    bindEvents();
  });
  function showState(id) {
    $$('.phase').forEach((p) => p.classList.remove('active'));
    $('#' + id).classList.add('active');
    window.scrollTo({ top: 0 });
    initReveals(document);
  }
  /* ---------- join ---------- */
  function checkReady() {
    const name = $('#inp-name').value.trim();
    const room = roomCode || $('#inp-room').value.trim();
    $('#btn-join').disabled = !name || !room;
  }
  function bindEvents() {
    $('#inp-name').addEventListener('input', checkReady);
    $('#inp-room').addEventListener('input', checkReady);
    $('#join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      voterName = $('#inp-name').value.trim();
      roomCode  = roomCode || $('#inp-room').value.trim().toUpperCase();
      if (!voterName || !roomCode) return;
      $('#nav-room').textContent = 'Room ' + roomCode;
      connect();
    });
    $('#btn-submit').addEventListener('click', submitBallot);
  }
  /* ---------- peer connection ---------- */
  function connect() {
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
          movies      = data.movies;
          totalPoints = data.totalPoints;
          buildBallot();
        }
        if (data.type === 'results') showResults(data);
      });
      conn.on('error', () => fail('Could not reach that room. Double-check the code.'));
      conn.on('close', () => {
        if (!movies.length) fail('The host closed the connection.');
      });
      setTimeout(() => {
        if (!opened) {
          fail('Connection timed out. Make sure the host session is still open.');
          try { peer.destroy(); } catch (e) {}
        }
      }, 15000);
    });
    peer.on('error', (err) => fail('Network error: ' + (err.type || err.message)));
  }
  function fail(msg) {
    $('#error-msg').textContent = msg;
    showState('state-error');
  }
  /* ---------- ballot UI ---------- */
  function buildBallot() {
    movies.forEach((m) => (allocated[m.id] = 0));
    $('#vote-title').textContent = `Welcome, ${voterName}`;
    $('#vote-sub').textContent =
      `Spread ${totalPoints} points across ${movies.length} films however you like`;
    $('#vote-movies').innerHTML = movies
      .map((m, i) => {
        const meta = [
          m.director && 'Dir. ' + m.director,
          m.runtime,
          m.year,
        ].filter(Boolean).join(' · ');
        const delay = 'delay-' + Math.min(i + 1, 5);
        return `
          <article class="vote-card reveal reveal-up ${delay}" data-id="${m.id}">
            <div class="vote-poster">${posterHTML(m.poster)}</div>
            <div class="vote-body">
              ${m.genre ? `<p class="movie-tagline">${esc(m.genre)}</p>` : ''}
              <h3>${esc(m.title)}</h3>
              ${meta ? `<p class="vote-meta">${esc(meta)}</p>` : ''}
              ${m.description ? `<p class="movie-desc">${esc(m.description)}</p>` : ''}
              <div class="pt-controls">
                <button type="button" class="pt-btn" data-mid="${m.id}" data-d="-1" aria-label="Remove point">−</button>
                <span class="pt-value" id="pv-${m.id}">0</span>
                <button type="button" class="pt-btn" data-mid="${m.id}" data-d="1" aria-label="Add point">+</button>
              </div>
            </div>
          </article>`;
      })
      .join('');
    $('#vote-movies').addEventListener('click', (e) => {
      const btn = e.target.closest('.pt-btn');
      if (btn) adjust(btn.dataset.mid, Number(btn.dataset.d));
    });
    refreshPoints();
    showState('state-voting');
  }
  function remaining() {
    return totalPoints - Object.values(allocated).reduce((a, b) => a + b, 0);
  }
  function adjust(mid, delta) {
    if (delta < 0 && allocated[mid] <= 0) return;
    if (delta > 0 && remaining() <= 0) return;
    allocated[mid] += delta;
    const val = $('#pv-' + mid);
    val.textContent = allocated[mid];
    val.classList.add('bump');
    setTimeout(() => val.classList.remove('bump'), 150);
    refreshPoints();
  }
  function refreshPoints() {
    const left = remaining();
    const used = totalPoints - left;
    $('#pts-remaining').textContent = left;
    $('#points-banner').classList.toggle('spent', left === 0);
    movies.forEach((m) => {
      const card = $(`.vote-card[data-id="${m.id}"]`);
      card.classList.toggle('has-points', allocated[m.id] > 0);
      card.querySelector('[data-d="-1"]').disabled = allocated[m.id] <= 0;
      card.querySelector('[data-d="1"]').disabled  = left <= 0;
    });
    $('#btn-submit').disabled = used === 0;
    $('#btn-submit span').textContent = left === 0
      ? 'Submit Ballot'
      : `Submit Ballot · ${left} pt${left !== 1 ? 's' : ''} unspent`;
  }
  function submitBallot() {
    if (!conn || !conn.open) {
      return fail('Lost connection to the host. Refresh and rejoin.');
    }
    conn.send({ type: 'vote', votes: { ...allocated } });
    showState('state-submitted');
  }
  /* ---------- results ---------- */
  function showResults(r) {
    $('#voter-winner').innerHTML = window.winnerHTML(r);
    $('#voter-bars').innerHTML   = window.barsHTML(r, false);
    showState('state-results');
  }
  /* ---------- shared result markup (mirrors host.js) ---------- */
  window.winnerHTML = window.winnerHTML || function (r) {
    const { movies: list, totals, maxPts, winnerIds, voterCount } = r;
    if (!winnerIds.length) return `<div class="trophy">🤷</div><h2>No Votes Cast</h2>`;
    if (winnerIds.length === 1) {
      const w = list.find((m) => m.id === winnerIds[0]);
      return `<div class="trophy">🏆</div><h2>${esc(w.title)}</h2>
              <p class="winner-sub">${totals[w.id]} points · ${voterCount} ballot${voterCount !== 1 ? 's' : ''}</p>`;
    }
    const names = winnerIds.map((id) => list.find((m) => m.id === id).title);
    return `<div class="trophy">🤝</div><h2>It's a Tie</h2>
            <p class="winner-sub">${names.map(esc).join(' &amp; ')} — ${maxPts} pts each</p>`;
  };
  window.barsHTML = window.barsHTML || function (r) {
    const { movies: list, totals, backers, pot, maxPts, winnerIds, voterCount } = r;
    return list.slice()
      .sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0))
      .map((m, i) => {
        const pts   = totals[m.id] || 0;
        const width = maxPts > 0 ? (pts / maxPts) * 100 : 0;
        const share = pot > 0 ? Math.round((pts / pot) * 100) : 0;
        const win   = winnerIds.includes(m.id);
        return `
          <div class="result-row${win ? ' winner' : ''} reveal reveal-up delay-${Math.min(i + 1, 5)}">
            <div class="result-fill" style="width:${width}%"></div>
            <div class="result-inner">
              <span class="result-title">${win ? '👑 ' : ''}${esc(m.title)}</span>
              <span class="result-pts">${pts} pt${pts !== 1 ? 's' : ''}</span>
            </div>
            <p class="result-breakdown">${share}% of the pot · backed by ${backers[m.id] || 0}/${voterCount}</p>
          </div>`;
      }).join('');
  };
})();