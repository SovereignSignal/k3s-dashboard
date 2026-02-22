// AI Arena frontend
let participants = [];
let selectedParticipants = new Set();
let currentMatch = null;

// Load available participants
async function loadParticipants() {
  try {
    participants = await api.get('/api/arena/participants');
    renderParticipants();
    updateBattleButton();
  } catch (err) {
    toast.error('Error', 'Failed to load participants');
  }
}

function renderParticipants() {
  const container = document.getElementById('participantsSelect');
  if (participants.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem;">No models online. Deploy Ollama templates first.</p>';
    return;
  }

  container.innerHTML = participants.map(p => {
    const isSelected = selectedParticipants.has(p.id);
    return `<label class="arena-participant-checkbox ${isSelected ? 'selected' : ''}" data-id="${p.id}">
      <input type="checkbox" ${isSelected ? 'checked' : ''} />
      <span>${p.name}</span>
      <span style="font-size: 0.65rem; opacity: 0.7;">${p.model}</span>
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
  btn.disabled = count < 2;
  btn.textContent = count < 2 ? 'Select 2+ models' : `Battle! (${count} models)`;
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

  const battleBtn = document.getElementById('battleBtn');
  battleBtn.disabled = true;
  battleBtn.textContent = 'Running...';

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
    battleBtn.disabled = false;
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
      html += `<div class="arena-winner-banner">Winner: ${winner.participantName} (${winner.model})</div>`;
    }
  }

  html += '<div class="arena-results">';
  for (const result of match.results) {
    const isFastest = result.totalTime === fastestTime && !result.error;
    const isWinner = match.winnerId === result.participantId;

    html += `<div class="arena-response-card ${isWinner ? 'winner' : ''}">
      <div class="arena-response-card-header">
        <span class="arena-model-name">${result.participantName}</span>
        <div class="arena-timing">
          <span class="arena-timing-badge ${isFastest ? 'fast' : ''}">${(result.totalTime / 1000).toFixed(1)}s</span>
          ${result.tokensPerSecond ? `<span class="arena-timing-badge">${result.tokensPerSecond} t/s</span>` : ''}
        </div>
      </div>
      <div class="arena-response-text ${result.error ? 'arena-response-error' : ''}">
        ${result.error ? `Error: ${result.error}` : escapeHtml(result.response)}
      </div>
      <div class="arena-response-footer">
        <span class="arena-token-info">${result.model}${result.tokenCount ? ` | ${result.tokenCount} tokens` : ''}</span>
        ${!result.error ? `<button class="arena-vote-btn ${isWinner ? 'voted' : ''}" onclick="vote('${match.id}', '${result.participantId}')">${isWinner ? 'Winner' : 'Vote'}</button>` : ''}
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
  html += '<th>Time</th><th>Prompt</th><th>Participants</th><th>Winner</th>';
  html += '</tr></thead><tbody>';

  for (const match of matches.slice(0, 20)) {
    const winner = match.winnerId
      ? match.results.find(r => r.participantId === match.winnerId)
      : null;
    const time = new Date(match.createdAt).toLocaleTimeString();
    const participantNames = match.results.map(r => r.participantName).join(', ');

    html += `<tr>
      <td>${time}</td>
      <td class="prompt-snippet" title="${escapeHtml(match.prompt)}">${escapeHtml(match.prompt)}</td>
      <td>${participantNames}</td>
      <td>${winner ? winner.participantName : '<span style="color: var(--text-muted);">-</span>'}</td>
    </tr>`;
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
