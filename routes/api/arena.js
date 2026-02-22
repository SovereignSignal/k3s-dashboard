const { Router } = require('express');

const router = Router();

// Arena state
let arenaState = {
  matches: [],
  isRunning: false,
};

// Default Ollama endpoints to check (same as backroom)
const defaultEndpoints = [
  { id: 'tinyllama', name: 'TinyLlama', url: 'http://ollama-tinyllama.default.svc.cluster.local:11434', model: 'tinyllama' },
  { id: 'qwen', name: 'Qwen3', url: 'http://ollama-qwen.default.svc.cluster.local:11434', model: 'qwen3:1.7b' },
  { id: 'phi', name: 'Phi-4', url: 'http://ollama-phi.default.svc.cluster.local:11434', model: 'phi4-mini' },
  { id: 'gemma', name: 'Gemma 3', url: 'http://ollama-gemma.default.svc.cluster.local:11434', model: 'gemma3:1b' },
  { id: 'deepseek', name: 'DeepSeek', url: 'http://ollama-deepseek.default.svc.cluster.local:11434', model: 'deepseek-r1:1.5b' },
  { id: 'qwen3-06b', name: 'Qwen3 0.6B', url: 'http://ollama-qwen3-06b.default.svc.cluster.local:11434', model: 'qwen3:0.6b' },
  { id: 'smollm2', name: 'SmolLM2', url: 'http://ollama-smollm2.default.svc.cluster.local:11434', model: 'smollm2:1.7b' },
  { id: 'llama32', name: 'Llama 3.2', url: 'http://ollama-llama32.default.svc.cluster.local:11434', model: 'llama3.2:1b' },
  { id: 'moondream', name: 'Moondream', url: 'http://ollama-moondream.default.svc.cluster.local:11434', model: 'moondream:1.8b' },
  { id: 'gemma3-270m', name: 'Gemma 3 270M', url: 'http://ollama-gemma3-270m.default.svc.cluster.local:11434', model: 'gemma3:270m' },
  { id: 'ollama', name: 'Ollama', url: 'http://ollama.default.svc.cluster.local:11434', model: 'default' },
];

// Check if an Ollama endpoint is healthy
async function checkEndpoint(endpoint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${endpoint.url}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const models = data.models || [];

    let model = endpoint.model;
    if (models.length > 0 && model === 'default') {
      model = models[0].name;
    }

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

// Generate a response from an Ollama endpoint with timing
async function generateWithTiming(participant, prompt, config) {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 min for slow Pi

    const response = await fetch(`${participant.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: participant.model,
        prompt,
        stream: false,
        options: {
          temperature: config.temperature || 0.7,
          num_predict: config.maxTokens || 256,
        },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const totalTime = Date.now() - startTime;

    return {
      participantId: participant.id,
      participantName: participant.name,
      model: participant.model,
      response: data.response?.trim() || '[No response]',
      totalTime,
      tokenCount: data.eval_count || null,
      tokensPerSecond: data.eval_count && data.eval_duration
        ? ((data.eval_count / data.eval_duration) * 1e9).toFixed(1)
        : null,
      error: null,
    };
  } catch (error) {
    return {
      participantId: participant.id,
      participantName: participant.name,
      model: participant.model,
      response: null,
      totalTime: Date.now() - startTime,
      tokenCount: null,
      tokensPerSecond: null,
      error: error.message,
    };
  }
}

// GET /api/arena/participants - discover healthy endpoints
router.get('/participants', async (req, res) => {
  const available = await discoverParticipants();
  res.json(available.map(p => ({
    id: p.id,
    name: p.name,
    model: p.model,
    availableModels: p.availableModels,
  })));
});

// POST /api/arena/match - run a match
router.post('/match', async (req, res) => {
  if (arenaState.isRunning) {
    return res.status(400).json({ error: 'A match is already running' });
  }

  const { prompt, participants: participantIds, config = {} } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  if (!participantIds || participantIds.length < 2) {
    return res.status(400).json({ error: 'At least 2 participants required' });
  }

  arenaState.isRunning = true;

  try {
    const available = await discoverParticipants();
    const selected = available.filter(p => participantIds.includes(p.id));

    if (selected.length < 2) {
      arenaState.isRunning = false;
      return res.status(400).json({
        error: 'Not enough selected participants are online',
        available: available.map(p => p.id),
      });
    }

    // Run all participants in parallel
    const results = await Promise.all(
      selected.map(p => generateWithTiming(p, prompt, config))
    );

    const match = {
      id: Date.now().toString(),
      prompt,
      config,
      results,
      winnerId: null,
      createdAt: new Date().toISOString(),
    };

    arenaState.matches.unshift(match);

    // Keep only last 50 matches
    if (arenaState.matches.length > 50) {
      arenaState.matches = arenaState.matches.slice(0, 50);
    }

    arenaState.isRunning = false;
    res.json(match);
  } catch (error) {
    arenaState.isRunning = false;
    res.status(500).json({ error: error.message });
  }
});

// GET /api/arena/matches - get match history
router.get('/matches', (req, res) => {
  res.json(arenaState.matches);
});

// POST /api/arena/vote - vote for a winner
router.post('/vote', (req, res) => {
  const { matchId, winnerId } = req.body;

  const match = arenaState.matches.find(m => m.id === matchId);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  match.winnerId = winnerId;
  res.json({ success: true, match });
});

// DELETE /api/arena/matches - clear history
router.delete('/matches', (req, res) => {
  arenaState.matches = [];
  res.json({ success: true });
});

module.exports = router;
