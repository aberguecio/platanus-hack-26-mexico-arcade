// The standalone web edition supplies network scoring outside the offline competition script.
(() => {
  const endpoint = 'https://highscores.berguecio.cl/games/g_b6d93ffb38134871/highscores';
  window.extractionMenu = '\nI global scores';
  window.platanusArcadeStorage ??= {
    async get(key) {
      const raw = localStorage.getItem('one-more-extraction:' + key);
      return raw === null ? { found: false } : { found: true, value: JSON.parse(raw) };
    },
    async set(key, value) {
      localStorage.setItem('one-more-extraction:' + key, JSON.stringify(value));
    }
  };

  let entry = null;
  let boardVersion = 0;
  let viewingBoard = false;
  let lastInitials = 'AAA';

  function showEntry() {
    const letters = [...entry.initials].map((letter, i) => i === entry.cursor ? '[' + letter + ']' : ' ' + letter + ' ');
    msgText.setText([
      'LEVEL ' + entry.level + '     SCORE ' + entry.score,
      '', 'GLOBAL LEADERBOARD', '', letters.join(' '), '',
      'W / S   change initial     A / D   move',
      'ENTER   submit             O   skip'
    ].join('\n'));
  }

  window.onExtractionScore = score => {
    viewingBoard = false;
    entry = { score, level: levelN, initials: [...lastInitials], cursor: 0, report: msgText.text };
    // A held start input from the final tick must not dismiss the debrief.
    consumePress('START1');
    showEntry();
  };

  async function displayBoard() {
    const version = ++boardVersion;
    viewingBoard = true;
    titleText.setText('GLOBAL TOP FIVE');
    msgText.setText('Loading scores…\n\nI to return');
    let lines;
    try {
      const response = await fetch(endpoint + '?limit=5', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const { highscores } = await response.json();
      lines = highscores.slice(0, 5).map(({ player_name, score }, i) =>
        (i + 1) + '.  ' + String(player_name).replace(/\s/g, ' ').slice(0, 32) + '   ' + score);
      if (!lines.length) lines.push('No scores yet.');
    } catch {
      lines = ['Could not load scores. Open the board again to retry.'];
    }
    if (version === boardVersion && viewingBoard && mode === 'title') {
      msgText.setText(lines.join('\n\n') + '\n\nI to return     ENTER to play');
    }
  }

  async function submit(run) {
    lastInitials = run.initials.join('');
    msgText.setText('Sending score…\n\n' + run.report);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_name: lastInitials, score: run.score })
      });
      if (!response.ok) throw new Error();
      if (mode === 'gameover' && entry === run) msgText.setText('SCORE SUBMITTED\n\n' + run.report + '\n\nENTER to continue');
    } catch {
      if (mode === 'gameover' && entry === run) msgText.setText('Could not confirm submission.\n\n' + run.report + '\n\nENTER to continue');
    }
  }

  window.addEventListener('keydown', event => {
    if (typeof mode === 'undefined' || !titleText) return;
    const key = event.key.toLowerCase();
    if (mode === 'title' && key === 'i') {
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.repeat) return;
      if (viewingBoard) {
        viewingBoard = false;
        goTitle();
      } else {
        void displayBoard();
      }
      return;
    }
    if (mode === 'title' && key === 'enter') viewingBoard = false;
    if (mode !== 'gameover' || !entry) return;
    if (entry.sent && !event.repeat) return;
    if (!['w', 's', 'a', 'd', 'enter', 'o'].includes(key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || entry.sent) return;
    if (key === 'enter') {
      entry.sent = true;
      void submit(entry);
    } else if (key === 'o') {
      msgText.setText(entry.report + '\n\nENTER to continue');
      entry = null;
    } else {
      if (key === 'a' || key === 'd') entry.cursor = (entry.cursor + (key === 'a' ? 2 : 1)) % 3;
      else {
        const code = entry.initials[entry.cursor].charCodeAt(0) - 65;
        entry.initials[entry.cursor] = String.fromCharCode(65 + (code + (key === 'w' ? 1 : 25)) % 26);
      }
      showEntry();
    }
  }, true);
})();
