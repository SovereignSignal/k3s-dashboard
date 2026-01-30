const { Router } = require('express');

const router = Router();

// Configuration - can be updated at runtime
const config = {
  temperature: 0.9,
  topP: 0.95,
  maxTokens: 256,
  turnDelayMs: 3000,
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

let turnTimeout = null;

// Default Ollama endpoints to check
const defaultEndpoints = [
  { id: 'tinyllama', name: 'TinyLlama', url: 'http://ollama-tinyllama.default.svc.cluster.local:11434', model: 'tinyllama' },
  { id: 'qwen', name: 'Qwen', url: 'http://ollama-qwen.default.svc.cluster.local:11434', model: 'qwen2.5:1.5b' },
  { id: 'phi', name: 'Phi-3', url: 'http://ollama-phi.default.svc.cluster.local:11434', model: 'phi3:mini' },
  { id: 'gemma', name: 'Gemma', url: 'http://ollama-gemma.default.svc.cluster.local:11434', model: 'gemma:2b' },
  { id: 'deepseek', name: 'DeepSeek', url: 'http://ollama-deepseek.default.svc.cluster.local:11434', model: 'deepseek-r1:1.5b' },
  { id: 'ollama', name: 'Ollama', url: 'http://ollama.default.svc.cluster.local:11434', model: 'default' },
];

// Check if an Ollama endpoint is healthy and get its model
async function checkEndpoint(endpoint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${endpoint.url}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const models = data.models || [];

    // Get the first available model, or use the default
    let model = endpoint.model;
    if (models.length > 0 && model === 'default') {
      model = models[0].name;
    }

    // Check if the specified model is available
    const hasModel = models.some(m => m.name === model || m.name.startsWith(model.split(':')[0]));
    if (!hasModel && models.length > 0) {
      model = models[0].name;
    }

    return {
      ...endpoint,
      model,
      availableModels: models.map(m => m.name),
    };
  } catch {
    return null;
  }
}

// Discover active participants
async function discoverParticipants() {
  const checks = await Promise.all(defaultEndpoints.map(checkEndpoint));
  return checks.filter(Boolean);
}

// Generate a response from an Ollama endpoint
async function generateResponse(participant, messages, settings) {
  const prompt = buildPrompt(participant, messages);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout for slow Pi inference

    const response = await fetch(`${participant.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: participant.model,
        prompt,
        stream: false,
        options: {
          temperature: settings.temperature,
          top_p: settings.topP,
          num_predict: settings.maxTokens,
        },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.response?.trim() || '[No response]';
  } catch (error) {
    console.error(`Backroom: Error from ${participant.name}:`, error.message);
    return `[Error: ${error.message}]`;
  }
}

// Build a conversation prompt for a participant
function buildPrompt(participant, messages) {
  let prompt = `You are in a casual group chat with other AI assistants. Be natural, curious, and engaging. Keep responses brief (1-3 sentences). React to what others say, ask questions, share thoughts, or take the conversation in new directions.\n\n`;

  if (messages.length === 0) {
    prompt += 'The chat just started. Say something to kick off the conversation - maybe introduce yourself briefly or bring up an interesting topic.';
  } else {
    prompt += 'Chat history:\n';
    const recentMessages = messages.slice(-12); // Last 12 messages for context
    for (const msg of recentMessages) {
      if (msg.participantId === 'system') {
        prompt += `[${msg.content}]\n`;
      } else {
        prompt += `${msg.participant}: ${msg.content}\n`;
      }
    }
    prompt += `\nYour turn to respond:`;
  }

  return prompt;
}

// Run one turn of conversation
async function runTurn() {
  if (!conversation.isRunning || conversation.participants.length < 2) {
    conversation.isRunning = false;
    return;
  }

  const participantIndex = conversation.currentTurn % conversation.participants.length;
  const participant = conversation.participants[participantIndex];

  console.log(`Backroom turn ${conversation.currentTurn + 1}: ${participant.name} (${participant.model}) thinking...`);

  const response = await generateResponse(participant, conversation.messages, config);

  // Don't add error messages as turns, retry with next participant
  if (response.startsWith('[Error:')) {
    console.log(`Backroom: Skipping ${participant.name} due to error`);
    conversation.currentTurn++;
    if (conversation.isRunning) {
      turnTimeout = setTimeout(runTurn, 1000);
    }
    return;
  }

  const message = {
    id: Date.now(),
    participant: participant.name,
    participantId: participant.id,
    model: participant.model,
    content: response,
    timestamp: new Date().toISOString(),
    turn: conversation.currentTurn,
  };

  conversation.messages.push(message);
  conversation.currentTurn++;

  console.log(`Backroom: ${participant.name}: ${response.substring(0, 100)}...`);

  // Schedule next turn
  if (conversation.isRunning) {
    turnTimeout = setTimeout(runTurn, config.turnDelayMs);
  }
}

// API Routes

// Get current status and config
router.get('/status', async (req, res) => {
  const available = await discoverParticipants();
  res.json({
    config,
    conversation: {
      isRunning: conversation.isRunning,
      messageCount: conversation.messages.length,
      participants: conversation.participants.map((p) => ({ id: p.id, name: p.name, model: p.model })),
      currentTurn: conversation.currentTurn,
      topic: conversation.topic,
      startedAt: conversation.startedAt,
    },
    availableParticipants: available.map((p) => ({ id: p.id, name: p.name, model: p.model, availableModels: p.availableModels })),
  });
});

// Update configuration
router.post('/config', (req, res) => {
  const { temperature, topP, maxTokens, turnDelayMs } = req.body;

  if (temperature !== undefined) config.temperature = Math.max(0.1, Math.min(2.0, parseFloat(temperature)));
  if (topP !== undefined) config.topP = Math.max(0.1, Math.min(1.0, parseFloat(topP)));
  if (maxTokens !== undefined) config.maxTokens = Math.max(32, Math.min(1024, parseInt(maxTokens, 10)));
  if (turnDelayMs !== undefined) config.turnDelayMs = Math.max(1000, Math.min(60000, parseInt(turnDelayMs, 10)));

  console.log('Backroom config updated:', config);
  res.json({ success: true, config });
});

// Get conversation messages (with polling support)
router.get('/messages', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const messages = conversation.messages.filter((m) => m.id > since);
  res.json({
    messages,
    isRunning: conversation.isRunning,
    currentTurn: conversation.currentTurn,
    totalMessages: conversation.messages.length,
  });
});

// Start conversation
router.post('/start', async (req, res) => {
  if (conversation.isRunning) {
    return res.status(400).json({ error: 'Conversation already running' });
  }

  const { topic, participantIds } = req.body;

  // Discover available participants
  const available = await discoverParticipants();

  if (available.length < 2) {
    return res.status(400).json({
      error: 'Need at least 2 online Ollama instances. Deploy some LLM templates first!',
      available: available.map((p) => p.name),
      hint: 'Deploy at least 2 Ollama model templates from the Templates section.',
    });
  }

  // Filter to requested participants or use all available
  let participants = available;
  if (participantIds && participantIds.length >= 2) {
    const filtered = available.filter((p) => participantIds.includes(p.id));
    if (filtered.length >= 2) {
      participants = filtered;
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

  console.log(`Backroom: Starting conversation with ${participants.map((p) => `${p.name}(${p.model})`).join(', ')}`);

  // Start the conversation loop
  turnTimeout = setTimeout(runTurn, 1000);

  res.json({
    success: true,
    participants: participants.map((p) => ({ id: p.id, name: p.name, model: p.model })),
    topic: conversation.topic,
  });
});

// Stop conversation
router.post('/stop', (req, res) => {
  conversation.isRunning = false;
  if (turnTimeout) {
    clearTimeout(turnTimeout);
    turnTimeout = null;
  }
  console.log('Backroom: Conversation stopped');
  res.json({ success: true });
});

// Clear conversation history
router.post('/clear', (req, res) => {
  conversation.isRunning = false;
  if (turnTimeout) {
    clearTimeout(turnTimeout);
    turnTimeout = null;
  }
  conversation.messages = [];
  conversation.currentTurn = 0;
  conversation.topic = null;
  conversation.startedAt = null;
  conversation.participants = [];
  console.log('Backroom: Conversation cleared');
  res.json({ success: true });
});

// Inject a message (user can participate)
router.post('/inject', (req, res) => {
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
  console.log(`Backroom: Injected message from ${msg.participant}`);

  res.json({ success: true, message: msg });
});

module.exports = router;
