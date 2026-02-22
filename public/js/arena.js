// AI Arena frontend
let participants = [];
let selectedParticipants = new Set();
let currentMatch = null;
let models = [];
let challengeList = [];
let challengeFilter = 'all';
let modelPollers = {};
let arenaRunning = false;

// Helper: escape for JS string inside HTML attribute (onclick)
function escapeJsAttr(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// --- Model management ---

async function loadModels() {
  try {
    models = await api.get('/api/arena/models');
    renderModels();
  } catch (err) {
    document.getElementById('modelGrid').innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem;">Failed to load models.</p>';
  }
}

function renderModels() {
  const grid = document.getElementById('modelGrid');
  if (models.length === 0) {
    grid.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem;">No AI templates found.</p>';
    return;
  }

  grid.innerHTML = models.map(m => {
    const statusClass = m.status === 'running' ? 'deployed' : m.status === 'starting' ? 'starting' : '';
    let actionBtn = '';
    if (m.status === 'not_deployed') {
      actionBtn = `<button class="arena-model-action" onclick="deployModel('${escapeJsAttr(m.templateId)}')">Deploy</button>`;
    } else if (m.status === 'running' && m.instanceId) {
      actionBtn = `<button class="arena-model-action teardown" onclick="teardownModel('${escapeJsAttr(m.instanceId)}', '${escapeJsAttr(m.name)}')">Remove</button>`;
    } else if (m.status === 'running' && !m.instanceId) {
      actionBtn = `<button class="arena-model-action" disabled title="Managed externally">Running</button>`;
    } else if (m.status === 'starting') {
      actionBtn = `<button class="arena-model-action" disabled>Starting...</button>`;
    }

    return `<div class="arena-model-card ${statusClass}">
      <div class="arena-model-card-header">
        <span class="arena-model-status ${m.status}"></span>
        <span class="arena-model-card-name" title="${escapeHtml(m.description)}">${escapeHtml(m.name)}</span>
      </div>
      <div class="arena-model-card-info">${m.ramEstimate ? escapeHtml(m.ramEstimate) + ' RAM' : 'Variable RAM'}</div>
      ${actionBtn}
    </div>`;
  }).join('');
}

async function deployModel(templateId) {
  const model = models.find(m => m.templateId === templateId);
  const name = model ? model.name : templateId;

  try {
    toast.info('Deploying', `Starting ${escapeHtml(name)}...`);
    await api.post('/api/arena/models/' + encodeURIComponent(templateId) + '/deploy');
    toast.success('Deployed', `${escapeHtml(name)} is starting up`);
    await loadModels();
    pollModelReady(templateId, name);
  } catch (err) {
    toast.error('Deploy Failed', err.message || 'Something went wrong');
  }
}

function pollModelReady(templateId, name) {
  if (modelPollers[templateId]) return;

  let attempts = 0;
  const maxAttempts = 30; // 30 * 5s = 150s

  modelPollers[templateId] = setInterval(async () => {
    attempts++;
    try {
      const freshModels = await api.get('/api/arena/models');
      const model = freshModels.find(m => m.templateId === templateId);

      if (model && model.status === 'running') {
        clearInterval(modelPollers[templateId]);
        delete modelPollers[templateId];
        models = freshModels;
        renderModels();
        toast.success('Ready', `${escapeHtml(name)} is now online`);
        loadParticipants();
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(modelPollers[templateId]);
        delete modelPollers[templateId];
        models = freshModels;
        renderModels();
        toast.warning('Timeout', `${escapeHtml(name)} is still starting...`);
      }
    } catch {
      // ignore polling errors
    }
  }, 5000);
}

async function teardownModel(instanceId, name) {
  const confirmed = await confirm({
    title: 'Remove Model',
    message: `Remove ${name}? PVCs will be preserved for fast re-deploy.`,
    confirmText: 'Remove',
    danger: true,
  });
  if (!confirmed) return;

  try {
    toast.info('Removing', `Tearing down ${escapeHtml(name)}...`);
    await api.del('/api/arena/models/' + encodeURIComponent(instanceId));
    toast.success('Removed', `${escapeHtml(name)} has been torn down`);
    await loadModels();
    loadParticipants();
  } catch (err) {
    toast.error('Teardown Failed', err.message || 'Something went wrong');
  }
}

async function toggleResources() {
  const bar = document.getElementById('resourcesBar');
  if (bar.classList.contains('visible')) {
    bar.classList.remove('visible');
    return;
  }

  try {
    const data = await api.get('/api/arena/resources');
    const nodes = data.items || [];

    bar.innerHTML = nodes.map(n => {
      const usedGB = n.memory.used;
      const totalGB = n.memory.total;
      const pct = totalGB > 0 ? (usedGB / totalGB * 100) : 0;
      const freeGB = (totalGB - usedGB).toFixed(1);
      const colorClass = pct > 85 ? 'red' : pct > 65 ? 'yellow' : 'green';

      return `<div class="arena-resource-node">
        <span class="arena-resource-node-name">${escapeHtml(n.name)}</span>
        <div class="arena-resource-bar">
          <div class="arena-resource-bar-fill ${colorClass}" style="width: ${pct.toFixed(0)}%"></div>
        </div>
        <span class="arena-resource-free">${freeGB} GB free</span>
      </div>`;
    }).join('');

    bar.classList.add('visible');
  } catch (err) {
    toast.error('Error', 'Failed to load resources');
  }
}

// --- Challenge functions ---

async function loadChallenges() {
  try {
    challengeList = await api.get('/api/arena/challenges');
    renderChallenges();
  } catch (err) {
    document.getElementById('challengeGrid').innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem;">Failed to load challenges.</p>';
  }
}

function filterChallenges(category) {
  challengeFilter = category;
  document.querySelectorAll('.arena-tab').forEach(tab => {
    tab.classList.toggle('active', tab.textContent.toLowerCase() === category || (category === 'all' && tab.textContent === 'All'));
  });
  renderChallenges();
}

function renderChallenges() {
  const grid = document.getElementById('challengeGrid');
  const filtered = challengeFilter === 'all' ? challengeList : challengeList.filter(c => c.category === challengeFilter);

  if (filtered.length === 0) {
    grid.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem;">No challenges in this category.</p>';
    return;
  }

  grid.innerHTML = filtered.map(c => {
    return `<div class="arena-challenge-card">
      <div class="arena-challenge-card-header">
        <span class="arena-challenge-card-icon">${c.icon}</span>
        <span class="arena-challenge-card-name">${escapeHtml(c.name)}</span>
      </div>
      <div class="arena-challenge-card-desc">${escapeHtml(c.description)}</div>
      <div class="arena-challenge-card-footer">
        <span class="arena-challenge-card-meta">${c.promptCount} prompts</span>
        <button class="arena-challenge-run-btn" onclick="runChallenge('${escapeJsAttr(c.id)}')" ${arenaRunning ? 'disabled' : ''}>Run Challenge</button>
      </div>
    </div>`;
  }).join('');
}

function setArenaRunning(running) {
  arenaRunning = running;
  // Disable/enable challenge run buttons
  document.querySelectorAll('.arena-challenge-run-btn').forEach(btn => {
    btn.disabled = running;
  });
}

async function runChallenge(challengeId) {
  if (selectedParticipants.size < 2) {
    toast.warning('Select Models', 'Select at least 2 models in Custom Battle to run a challenge');
    return;
  }

  if (arenaRunning) {
    toast.warning('Busy', 'A match is already running');
    return;
  }

  const challenge = challengeList.find(c => c.id === challengeId);
  const resultsArea = document.getElementById('resultsArea');
  resultsArea.innerHTML = `<div class="arena-loading"><div class="arena-spinner"></div><p>Running ${challenge ? escapeHtml(challenge.name) : 'challenge'}... (${challenge ? challenge.promptCount : '?'} rounds)</p></div>`;

  setArenaRunning(true);

  try {
    const match = await api.post('/api/arena/challenge', {
      challengeId,
      participants: Array.from(selectedParticipants),
    });

    currentMatch = match;
    renderChallengeResults(match);
    loadHistory();
  } catch (err) {
    resultsArea.innerHTML = '';
    toast.error('Challenge Failed', err.message || 'Something went wrong');
  } finally {
    setArenaRunning(false);
  }
}

function renderChallengeResults(match) {
  const resultsArea = document.getElementById('resultsArea');
  let html = '';

  // Scores banner
  const scoreEntries = Object.entries(match.scores);
  const maxCorrect = Math.max(...scoreEntries.map(([, s]) => s.correct));

  html += '<div class="arena-scores-banner">';
  for (const [, score] of scoreEntries) {
    const isTop = score.correct === maxCorrect && maxCorrect > 0;
    html += `<div class="arena-score-card ${isTop ? 'top-scorer' : ''}">
      <div class="arena-score-card-name">${escapeHtml(score.name)}</div>
      <div class="arena-score-card-score">${score.correct}/${match.rounds.length}</div>
      <div class="arena-score-card-meta">${(score.totalTime / 1000).toFixed(1)}s total | ${escapeHtml(score.avgTokensPerSecond)} t/s avg</div>
    </div>`;
  }
  html += '</div>';

  // Round-by-round results
  match.rounds.forEach((round, i) => {
    html += `<div class="arena-round">
      <div class="arena-round-header">
        <span>Round ${i + 1}: ${escapeHtml(round.prompt)}</span>
        ${round.answer ? `<span class="arena-round-answer">Answer: ${escapeHtml(round.answer)}</span>` : ''}
      </div>
      <div class="arena-results">`;

    for (const result of round.results) {
      const correctBadge = result.correct === true ? '<span class="arena-round-correct">Correct</span>'
        : result.correct === false ? '<span class="arena-round-wrong">Wrong</span>' : '';

      html += `<div class="arena-response-card">
        <div class="arena-response-card-header">
          <span class="arena-model-name">${escapeHtml(result.participantName)} ${correctBadge}</span>
          <div class="arena-timing">
            <span class="arena-timing-badge">${(result.totalTime / 1000).toFixed(1)}s</span>
            ${result.tokensPerSecond ? `<span class="arena-timing-badge">${escapeHtml(String(result.tokensPerSecond))} t/s</span>` : ''}
          </div>
        </div>
        <div class="arena-response-text ${result.error ? 'arena-response-error' : ''}">
          ${result.error ? `Error: ${escapeHtml(result.error)}` : escapeHtml(result.response)}
        </div>
        <div class="arena-response-footer">
          <span class="arena-token-info">${escapeHtml(result.model)}${result.tokenCount ? ` | ${result.tokenCount} tokens` : ''}</span>
        </div>
      </div>`;
    }

    html += '</div></div>';
  });

  resultsArea.innerHTML = html;
}

// --- Existing arena functions ---

// Load available participants
async function loadParticipants() {
  try {
    participants = await api.get('/api/arena/participants');
    // Prune stale selections
    const validIds = new Set(participants.map(p => p.id));
    for (const id of selectedParticipants) {
      if (!validIds.has(id)) selectedParticipants.delete(id);
    }
    renderParticipants();
    updateBattleButton();
  } catch (err) {
    toast.error('Error', 'Failed to load participants');
  }
}

function renderParticipants() {
  const container = document.getElementById('participantsSelect');
  if (participants.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem;">No models online. Deploy models above first.</p>';
    return;
  }

  container.innerHTML = participants.map(p => {
    const isSelected = selectedParticipants.has(p.id);
    return `<label class="arena-participant-checkbox ${isSelected ? 'selected' : ''}" data-id="${escapeJsAttr(p.id)}">
      <input type="checkbox" ${isSelected ? 'checked' : ''} />
      <span>${escapeHtml(p.name)}</span>
      <span style="font-size: 0.65rem; opacity: 0.7;">${escapeHtml(p.model)}</span>
    </label>`;
  }).join('');

  container.querySelectorAll('.arena-participant-checkbox').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.dataset.id;
      if (selectedParticipants.has(id)) {
        selectedParticipants.delete(id);
        el.classList.remove('selected');
        el.querySelector('input').checked = false;
      } else {
        selectedParticipants.add(id);
        el.classList.add('selected');
        el.querySelector('input').checked = true;
      }
      updateBattleButton();
    });
  });
}

function updateBattleButton() {
  const btn = document.getElementById('battleBtn');
  const count = selectedParticipants.size;
  btn.disabled = count < 2 || arenaRunning;
  btn.textContent = arenaRunning ? 'Running...' : count < 2 ? 'Select 2+ models' : `Battle! (${count} models)`;
}

// Start a match
async function startMatch() {
  const prompt = document.getElementById('promptInput').value.trim();
  if (!prompt) {
    toast.warning('Missing Prompt', 'Enter a prompt to test');
    return;
  }

  if (selectedParticipants.size < 2) {
    toast.warning('Not Enough', 'Select at least 2 models');
    return;
  }

  if (arenaRunning) {
    toast.warning('Busy', 'A match is already running');
    return;
  }

  const battleBtn = document.getElementById('battleBtn');
  setArenaRunning(true);
  updateBattleButton();

  const resultsArea = document.getElementById('resultsArea');
  resultsArea.innerHTML = '<div class="arena-loading"><div class="arena-spinner"></div><p>Models are thinking...</p></div>';

  const temperature = parseFloat(document.getElementById('tempSlider').value);
  const maxTokens = parseInt(document.getElementById('tokensSlider').value, 10);

  try {
    const match = await api.post('/api/arena/match', {
      prompt,
      participants: Array.from(selectedParticipants),
      config: { temperature, maxTokens },
    });

    currentMatch = match;
    renderResults(match);
    loadHistory();
  } catch (err) {
    resultsArea.innerHTML = '';
    toast.error('Match Failed', err.message || 'Something went wrong');
  } finally {
    setArenaRunning(false);
    updateBattleButton();
  }
}

function renderResults(match) {
  const resultsArea = document.getElementById('resultsArea');

  // Find fastest successful response
  const successfulResults = match.results.filter(r => !r.error);
  const fastestTime = successfulResults.length > 0
    ? Math.min(...successfulResults.map(r => r.totalTime))
    : null;

  let html = '';

  if (match.winnerId) {
    const winner = match.results.find(r => r.participantId === match.winnerId);
    if (winner) {
      html += `<div class="arena-winner-banner">Winner: ${escapeHtml(winner.participantName)} (${escapeHtml(winner.model)})</div>`;
    }
  }

  html += '<div class="arena-results">';
  for (const result of match.results) {
    const isFastest = result.totalTime === fastestTime && !result.error;
    const isWinner = match.winnerId === result.participantId;

    html += `<div class="arena-response-card ${isWinner ? 'winner' : ''}">
      <div class="arena-response-card-header">
        <span class="arena-model-name">${escapeHtml(result.participantName)}</span>
        <div class="arena-timing">
          <span class="arena-timing-badge ${isFastest ? 'fast' : ''}">${(result.totalTime / 1000).toFixed(1)}s</span>
          ${result.tokensPerSecond ? `<span class="arena-timing-badge">${escapeHtml(String(result.tokensPerSecond))} t/s</span>` : ''}
        </div>
      </div>
      <div class="arena-response-text ${result.error ? 'arena-response-error' : ''}">
        ${result.error ? `Error: ${escapeHtml(result.error)}` : escapeHtml(result.response)}
      </div>
      <div class="arena-response-footer">
        <span class="arena-token-info">${escapeHtml(result.model)}${result.tokenCount ? ` | ${result.tokenCount} tokens` : ''}</span>
        ${!result.error ? `<button class="arena-vote-btn ${isWinner ? 'voted' : ''}" onclick="vote('${escapeJsAttr(match.id)}', '${escapeJsAttr(result.participantId)}')">${isWinner ? 'Winner' : 'Vote'}</button>` : ''}
      </div>
    </div>`;
  }
  html += '</div>';

  resultsArea.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function vote(matchId, winnerId) {
  try {
    const result = await api.post('/api/arena/vote', { matchId, winnerId });
    currentMatch = result.match;
    renderResults(result.match);
    loadHistory();
    toast.success('Voted', 'Winner recorded');
  } catch (err) {
    toast.error('Error', 'Failed to record vote');
  }
}

async function loadHistory() {
  try {
    const matches = await api.get('/api/arena/matches');
    renderHistory(matches);
  } catch (err) {
    // Silently fail for history
  }
}

function renderHistory(matches) {
  const content = document.getElementById('historyContent');

  if (matches.length === 0) {
    content.innerHTML = `<div class="arena-empty">
      <div class="arena-empty-icon">&#9876;&#65039;</div>
      <h3>No matches yet</h3>
      <p>Select models and start a battle to compare responses</p>
    </div>`;
    return;
  }

  let html = '<table class="arena-history-table"><thead><tr>';
  html += '<th>Time</th><th>Type</th><th>Prompt</th><th>Participants</th><th>Winner</th>';
  html += '</tr></thead><tbody>';

  for (const match of matches.slice(0, 20)) {
    const time = new Date(match.createdAt).toLocaleTimeString();

    if (match.challengeId) {
      // Challenge match
      const scoreEntries = Object.entries(match.scores || {});
      const maxCorrect = Math.max(...scoreEntries.map(([, s]) => s.correct), 0);
      const topScorer = scoreEntries.find(([, s]) => s.correct === maxCorrect);
      const participantNames = scoreEntries.map(([, s]) => s.name).join(', ');
      const winnerText = topScorer ? `${escapeHtml(topScorer[1].name)} (${topScorer[1].correct}/${match.rounds.length})` : '-';

      html += `<tr>
        <td>${time}</td>
        <td><span class="arena-history-type challenge">${escapeHtml(match.challengeName)}</span></td>
        <td class="prompt-snippet" title="${escapeHtml(match.category)} challenge">${match.rounds.length} rounds</td>
        <td>${escapeHtml(participantNames)}</td>
        <td>${winnerText}</td>
      </tr>`;
    } else {
      // Custom match
      const winner = match.winnerId
        ? match.results.find(r => r.participantId === match.winnerId)
        : null;
      const participantNames = match.results.map(r => r.participantName).join(', ');

      html += `<tr>
        <td>${time}</td>
        <td><span class="arena-history-type">Custom</span></td>
        <td class="prompt-snippet" title="${escapeHtml(match.prompt)}">${escapeHtml(match.prompt)}</td>
        <td>${escapeHtml(participantNames)}</td>
        <td>${winner ? escapeHtml(winner.participantName) : '<span style="color: var(--text-muted);">-</span>'}</td>
      </tr>`;
    }
  }

  html += '</tbody></table>';
  content.innerHTML = html;
}

async function clearHistory() {
  try {
    await api.del('/api/arena/matches');
    loadHistory();
    toast.success('Cleared', 'Match history cleared');
  } catch (err) {
    toast.error('Error', 'Failed to clear history');
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadParticipants();
  loadHistory();
  loadModels();
  loadChallenges();

  document.getElementById('battleBtn').addEventListener('click', startMatch);
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

  // Slider value displays
  const tempSlider = document.getElementById('tempSlider');
  const tokensSlider = document.getElementById('tokensSlider');
  tempSlider.addEventListener('input', () => {
    document.getElementById('tempValue').textContent = tempSlider.value;
  });
  tokensSlider.addEventListener('input', () => {
    document.getElementById('tokensValue').textContent = tokensSlider.value;
  });

  // Enter key to start match
  document.getElementById('promptInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      startMatch();
    }
  });
});
