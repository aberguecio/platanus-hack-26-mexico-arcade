// The competition runner supplies its own storage. This adapter belongs to the standalone web edition.
(() => {
  const gameId = null; // Set to this game's registered public ID.
  const endpoint = /^g_[a-f0-9]{16}$/.test(gameId)
    ? 'https://highscores.berguecio.cl/games/' + gameId + '/highscores'
    : null;
  const ranking = document.querySelector('#ranking');
  const status = document.querySelector('#status');
  const dialog = document.querySelector('dialog');
  const form = document.querySelector('#entry');
  let pendingScore = null;
  let readVersion = 0;

  window.platanusArcadeStorage ??= {
    async get(key) {
      const raw = localStorage.getItem('one-more-extraction:' + key);
      return raw === null ? { found: false } : { found: true, value: JSON.parse(raw) };
    },
    async set(key, value) {
      localStorage.setItem('one-more-extraction:' + key, JSON.stringify(value));
    }
  };

  async function refresh() {
    const version = ++readVersion;
    try {
      const response = await fetch(endpoint + '?limit=5');
      if (!response.ok) throw new Error();
      const { highscores } = await response.json();
      const rows = highscores.slice(0, 5).map(({ player_name, score }) => {
        const row = document.createElement('li');
        row.textContent = player_name + ' · ' + score;
        return row;
      });
      if (version !== readVersion) return;
      ranking.replaceChildren(...rows);
      status.textContent = rows.length ? '' : 'No scores yet.';
    } catch {
      if (version === readVersion) status.textContent = 'Global scores are unavailable.';
    }
  }

  window.onExtractionScore = score => {
    if (!endpoint) return;
    pendingScore = score;
    document.querySelector('#points').textContent = score + ' points';
    dialog.showModal();
    form.elements.player.focus();
  };
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('close', () => { pendingScore = null; });
  document.querySelector('#skip').addEventListener('click', () => dialog.close());
  form.elements.player.addEventListener('input', () => form.elements.player.setCustomValidity(''));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const playerName = form.elements.player.value.trim();
    if (!playerName) {
      form.elements.player.setCustomValidity('Enter a player name.');
      form.elements.player.reportValidity();
      return;
    }
    if (pendingScore === null) return;
    const score = pendingScore;
    pendingScore = null;
    dialog.close();
    status.textContent = 'Submitting score…';
    ++readVersion;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_name: playerName, score })
      });
      if (!response.ok) throw new Error();
      await refresh();
    } catch {
      status.textContent = 'Submission could not be confirmed. Your local leaderboard is separate.';
    }
  });

  if (endpoint) refresh();
  else status.textContent = 'Global scores are not configured.';
})();
