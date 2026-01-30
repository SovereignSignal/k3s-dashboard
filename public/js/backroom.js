// LLM Backroom UI

let isRunning = false;
let lastMessageId = 0;
let pollInterval = null;

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const emptyState = document.getElementById('emptyState');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const injectInput = document.getElementById('injectInput');
const injectBtn = document.getElementById('injectBtn');
const topicInput = document.getElementById('topicInput');
const participantsList = document.getElementById('participantsList');
const messageCount = document.getElementById('messageCount');
const turnCount = document.getElementById('turnCount');

// Sliders
const tempSlider = document.getElementById('tempSlider');
const tempValue = document.getElementById('tempValue');
const topPSlider = document.getElementById('topPSlider');
const topPValue = document.getElementById('topPValue');
const maxTokensSlider = document.getElementById('maxTokensSlider');
const maxTokensValue = document.getElementById('maxTokensValue');
const delaySlider = document.getElementById('delaySlider');
const delayValue = document.getElementById('delayValue');

// Participant colors for visual distinction
const participantColors = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

const participantColorMap = {};
let colorIndex = 0;

function getParticipantColor(participantId) {
  if (!participantColorMap[participantId]) {
    participantColorMap[participantId] = participantColors[colorIndex % participantColors.length];
    colorIndex++;
  }
  return participantColorMap[participantId];
}

// Initialize
async function init() {
  await loadStatus();
  setupSliders();
  setupEventListeners();
  startPolling();
}

// Load current status
async function loadStatus() {
  try {
    const data = await api.get('/api/backroom/status');

    // Update config sliders
    tempSlider.value = data.config.temperature;
    tempValue.textContent = data.config.temperature.toFixed(1);
    topPSlider.value = data.config.topP;
    topPValue.textContent = data.config.topP.toFixed(2);
    maxTokensSlider.value = data.config.maxTokens;
    maxTokensValue.textContent = data.config.maxTokens;
    delaySlider.value = data.config.turnDelayMs;
    delayValue.textContent = (data.config.turnDelayMs / 1000) + 's';

    // Update participants list
    renderParticipants(data.availableParticipants, data.conversation.participants);

    // Update running state
    updateRunningState(data.conversation.isRunning);

    // Update stats
    messageCount.textContent = data.conversation.messageCount;
    turnCount.textContent = data.conversation.currentTurn;

  } catch (error) {
    console.error('Failed to load status:', error);
  }
}

// Render participants list
function renderParticipants(available, active) {
  const activeIds = active.map(p => p.id);

  if (available.length === 0) {
    participantsList.innerHTML = `
      <p style="color: var(--text-muted); font-size: 0.85rem;">
        No Ollama instances found.<br>
        <a href="/#templates" style="color: var(--primary-color);">Deploy some LLM templates</a>
      </p>
    `;
    return;
  }

  participantsList.innerHTML = available.map(p => {
    const isActive = activeIds.includes(p.id);
    const color = getParticipantColor(p.id);
    return `
      <div class="participant">
        <span class="participant-status" style="background: ${color}"></span>
        <span class="participant-name">${p.name}</span>
        <span class="participant-model">${p.model}</span>
      </div>
    `;
  }).join('');
}

// Setup slider event listeners
function setupSliders() {
  const updateConfig = debounce(async (key, value) => {
    try {
      await api.post('/api/backroom/config', { [key]: value });
    } catch (error) {
      console.error('Failed to update config:', error);
    }
  }, 300);

  tempSlider.addEventListener('input', () => {
    tempValue.textContent = parseFloat(tempSlider.value).toFixed(1);
    updateConfig('temperature', parseFloat(tempSlider.value));
  });

  topPSlider.addEventListener('input', () => {
    topPValue.textContent = parseFloat(topPSlider.value).toFixed(2);
    updateConfig('topP', parseFloat(topPSlider.value));
  });

  maxTokensSlider.addEventListener('input', () => {
    maxTokensValue.textContent = maxTokensSlider.value;
    updateConfig('maxTokens', parseInt(maxTokensSlider.value, 10));
  });

  delaySlider.addEventListener('input', () => {
    delayValue.textContent = (parseInt(delaySlider.value, 10) / 1000) + 's';
    updateConfig('turnDelayMs', parseInt(delaySlider.value, 10));
  });
}

// Setup button event listeners
function setupEventListeners() {
  startBtn.addEventListener('click', startConversation);
  stopBtn.addEventListener('click', stopConversation);
  clearBtn.addEventListener('click', clearConversation);
  injectBtn.addEventListener('click', injectMessage);

  injectInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      injectMessage();
    }
  });
}

// Start conversation
async function startConversation() {
  try {
    startBtn.disabled = true;
    const topic = topicInput.value.trim() || undefined;
    const data = await api.post('/api/backroom/start', { topic });

    if (data.success) {
      updateRunningState(true);
      lastMessageId = 0;
    }
  } catch (error) {
    alert(error.message || 'Failed to start conversation');
    startBtn.disabled = false;
  }
}

// Stop conversation
async function stopConversation() {
  try {
    await api.post('/api/backroom/stop');
    updateRunningState(false);
  } catch (error) {
    console.error('Failed to stop:', error);
  }
}

// Clear conversation
async function clearConversation() {
  try {
    await api.post('/api/backroom/clear');
    messagesContainer.innerHTML = '';
    emptyState.style.display = 'flex';
    messagesContainer.appendChild(emptyState);
    lastMessageId = 0;
    messageCount.textContent = '0';
    turnCount.textContent = '0';
    updateRunningState(false);
  } catch (error) {
    console.error('Failed to clear:', error);
  }
}

// Inject a message
async function injectMessage() {
  const message = injectInput.value.trim();
  if (!message) return;

  try {
    injectInput.disabled = true;
    injectBtn.disabled = true;

    await api.post('/api/backroom/inject', { message });
    injectInput.value = '';
  } catch (error) {
    console.error('Failed to inject:', error);
  } finally {
    injectInput.disabled = false;
    injectBtn.disabled = false;
    injectInput.focus();
  }
}

// Update UI based on running state
function updateRunningState(running) {
  isRunning = running;
  statusDot.classList.toggle('running', running);
  statusText.textContent = running ? 'Running' : 'Stopped';
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

// Poll for new messages
async function pollMessages() {
  try {
    const data = await api.get(`/api/backroom/messages?since=${lastMessageId}`);

    if (data.messages.length > 0) {
      // Hide empty state
      if (emptyState.parentNode === messagesContainer) {
        emptyState.style.display = 'none';
      }

      // Add new messages
      for (const msg of data.messages) {
        addMessage(msg);
        lastMessageId = Math.max(lastMessageId, msg.id);
      }

      // Auto-scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Update stats
    messageCount.textContent = data.totalMessages;
    turnCount.textContent = data.currentTurn;

    // Update running state
    if (isRunning !== data.isRunning) {
      updateRunningState(data.isRunning);
      // Reload full status to update participants
      await loadStatus();
    }
  } catch (error) {
    console.error('Poll error:', error);
  }
}

// Add a message to the chat
function addMessage(msg) {
  const div = document.createElement('div');

  if (msg.participantId === 'system') {
    div.className = 'message system';
    div.innerHTML = `<div class="message-content">${escapeHtml(msg.content)}</div>`;
  } else if (msg.participantId === 'human') {
    div.className = 'message human';
    div.innerHTML = `
      <div class="message-header">
        <span class="message-sender">${escapeHtml(msg.participant)}</span>
        <span class="message-time">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="message-content">${escapeHtml(msg.content)}</div>
    `;
  } else {
    const color = getParticipantColor(msg.participantId);
    div.className = 'message agent';
    div.innerHTML = `
      <div class="message-header">
        <span class="message-sender" style="color: ${color}">${escapeHtml(msg.participant)}</span>
        <span class="message-model">${escapeHtml(msg.model || '')}</span>
        <span class="message-time">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="message-content">${escapeHtml(msg.content)}</div>
    `;
  }

  messagesContainer.appendChild(div);
}

// Start polling
function startPolling() {
  pollMessages();
  pollInterval = setInterval(pollMessages, 1500);
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Start
document.addEventListener('DOMContentLoaded', init);
