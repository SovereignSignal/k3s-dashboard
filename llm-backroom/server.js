const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const config = {
  temperature: parseFloat(process.env.TEMPERATURE || '0.9'),
  topP: parseFloat(process.env.TOP_P || '0.95'),
  maxTokens: parseInt(process.env.MAX_TOKENS || '256', 10),
  turnDelayMs: parseInt(process.env.TURN_DELAY_MS || '2000', 10),
};

// Conversation state
let conversation = {
  messages: [],
  isRunning: false,
  participants: [],
  currentTurn: 0,
  topic: null,
  startedAt: null,
};

// Discover Ollama endpoints from environment or use defaults
function getParticipants() {
  const endpoints = process.env.OLLAMA_ENDPOINTS;
  if (endpoints) {
    return endpoints.split(',').map((ep, i) => {
      const [url, model] = ep.trim().split('|');
      return {
        id: `agent-${i + 1}`,
        name: model || `Agent ${i + 1}`,
        url: url,
        model: model || 'default',
      };
    });
  }
  // Default: look for common Ollama service names
  return [
    { id: 'tinyllama', name: 'TinyLlama', url: 'http://ollama-tinyllama:11434', model: 'tinyllama' },
    { id: 'qwen', name: 'Qwen', url: 'http://ollama-qwen:11434', model: 'qwen2.5:1.5b' },
    { id: 'phi', name: 'Phi-3', url: 'http://ollama-phi:11434', model: 'phi3:mini' },
    { id: 'gemma', name: 'Gemma', url: 'http://ollama-gemma:11434', model: 'gemma:2b' },
    { id: 'deepseek', name: 'DeepSeek', url: 'http://ollama-deepseek:11434', model: 'deepseek-r1:1.5b' },
  ];
}

// Check if an Ollama endpoint is healthy
async function checkHealth(participant) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${participant.url}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// Discover active participants
async function discoverParticipants() {
  const allParticipants = getParticipants();
  const checks = await Promise.all(
    allParticipants.map(async (p) => ({
      ...p,
      isOnline: await checkHealth(p),
    }))
  );
  return checks.filter((p) => p.isOnline);
}

// Generate a response from an Ollama endpoint
async function generateResponse(participant, messages, settings) {
  const prompt = buildPrompt(participant, messages);

  try {
    const response = await fetch(`${participant.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: participant.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: settings.temperature,
          top_p: settings.topP,
          num_predict: settings.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.response?.trim() || '[No response]';
  } catch (error) {
    console.error(`Error from ${participant.name}:`, error.message);
    return `[Error: ${error.message}]`;
  }
}

// Build a conversation prompt for a participant
function buildPrompt(participant, messages) {
  let prompt = `You are ${participant.name}, participating in a group conversation with other AI models. Be yourself - respond naturally and authentically. Keep responses concise (1-3 sentences). Engage with what others have said.\n\n`;

  if (messages.length === 0) {
    prompt += 'The conversation is just starting. Say something to begin the discussion.';
  } else {
    prompt += 'Conversation so far:\n';
    for (const msg of messages.slice(-10)) { // Last 10 messages for context
      const speaker = msg.participant === participant.name ? 'You' : msg.participant;
      prompt += `${speaker}: ${msg.content}\n`;
    }
    prompt += `\n${participant.name}, what do you say next?`;
  }

  return prompt;
}

// Run one turn of conversation
async function runTurn() {
  if (!conversation.isRunning || conversation.participants.length < 2) {
    conversation.isRunning = false;
    return;
  }

  const participant = conversation.participants[conversation.currentTurn % conversation.participants.length];

  console.log(`Turn ${conversation.currentTurn + 1}: ${participant.name} is thinking...`);

  const response = await generateResponse(participant, conversation.messages, config);

  const message = {
    id: Date.now(),
    participant: participant.name,
    participantId: participant.id,
    content: response,
    timestamp: new Date().toISOString(),
    turn: conversation.currentTurn,
  };

  conversation.messages.push(message);
  conversation.currentTurn++;

  console.log(`${participant.name}: ${response}`);

  // Schedule next turn
  if (conversation.isRunning) {
    setTimeout(runTurn, config.turnDelayMs);
  }
}

// API Routes

// Get current status and config
app.get('/api/status', async (req, res) => {
  const available = await discoverParticipants();
  res.json({
    config,
    conversation: {
      isRunning: conversation.isRunning,
      messageCount: conversation.messages.length,
      participants: conversation.participants.map((p) => p.name),
      currentTurn: conversation.currentTurn,
      topic: conversation.topic,
      startedAt: conversation.startedAt,
    },
    availableParticipants: available.map((p) => ({ id: p.id, name: p.name, model: p.model })),
  });
});

// Update configuration
app.post('/api/config', (req, res) => {
  const { temperature, topP, maxTokens, turnDelayMs } = req.body;

  if (temperature !== undefined) config.temperature = Math.max(0.1, Math.min(2.0, parseFloat(temperature)));
  if (topP !== undefined) config.topP = Math.max(0.1, Math.min(1.0, parseFloat(topP)));
  if (maxTokens !== undefined) config.maxTokens = Math.max(32, Math.min(1024, parseInt(maxTokens, 10)));
  if (turnDelayMs !== undefined) config.turnDelayMs = Math.max(500, Math.min(30000, parseInt(turnDelayMs, 10)));

  console.log('Config updated:', config);
  res.json({ success: true, config });
});

// Get conversation messages
app.get('/api/messages', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const messages = conversation.messages.filter((m) => m.id > since);
  res.json({
    messages,
    isRunning: conversation.isRunning,
    currentTurn: conversation.currentTurn,
  });
});

// Start conversation
app.post('/api/start', async (req, res) => {
  if (conversation.isRunning) {
    return res.status(400).json({ error: 'Conversation already running' });
  }

  const { topic, participantIds } = req.body;

  // Discover available participants
  const available = await discoverParticipants();

  if (available.length < 2) {
    return res.status(400).json({
      error: 'Need at least 2 online Ollama instances to start a conversation',
      available: available.map((p) => p.name),
    });
  }

  // Filter to requested participants or use all available
  let participants = available;
  if (participantIds && participantIds.length >= 2) {
    participants = available.filter((p) => participantIds.includes(p.id));
    if (participants.length < 2) {
      participants = available;
    }
  }

  // Reset and start
  conversation = {
    messages: [],
    isRunning: true,
    participants,
    currentTurn: 0,
    topic: topic || null,
    startedAt: new Date().toISOString(),
  };

  // If topic provided, add it as a system message
  if (topic) {
    conversation.messages.push({
      id: Date.now(),
      participant: 'System',
      participantId: 'system',
      content: `Topic: ${topic}`,
      timestamp: new Date().toISOString(),
      turn: -1,
    });
  }

  console.log(`Starting conversation with ${participants.map((p) => p.name).join(', ')}`);

  // Start the conversation loop
  setTimeout(runTurn, 1000);

  res.json({
    success: true,
    participants: participants.map((p) => ({ id: p.id, name: p.name })),
    topic: conversation.topic,
  });
});

// Stop conversation
app.post('/api/stop', (req, res) => {
  conversation.isRunning = false;
  console.log('Conversation stopped');
  res.json({ success: true });
});

// Clear conversation history
app.post('/api/clear', (req, res) => {
  conversation.messages = [];
  conversation.currentTurn = 0;
  conversation.topic = null;
  conversation.startedAt = null;
  console.log('Conversation cleared');
  res.json({ success: true });
});

// Inject a message (user can participate)
app.post('/api/inject', (req, res) => {
  const { message, as } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  const msg = {
    id: Date.now(),
    participant: as || 'Human',
    participantId: 'human',
    content: message,
    timestamp: new Date().toISOString(),
    turn: conversation.currentTurn,
    injected: true,
  };

  conversation.messages.push(msg);
  console.log(`Injected: ${msg.participant}: ${message}`);

  res.json({ success: true, message: msg });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`LLM Backroom orchestrator running on port ${PORT}`);
  console.log(`Temperature: ${config.temperature}, Top-P: ${config.topP}`);
});
