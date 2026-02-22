const { Router } = require('express');
const { templates: allTemplates, substituteConfig } = require('./templates');
const appManager = require('../../services/app-manager');
const k8sClient = require('../../services/k8s-client');

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

// Template ID to arena participant ID mapping
const templateToParticipant = {};
for (const ep of defaultEndpoints) {
  const templateId = ep.id === 'ollama' ? 'ollama' : `ollama-${ep.id}`;
  templateToParticipant[templateId] = ep.id;
}

// Challenge templates
const challenges = [
  {
    id: 'trivia-general',
    name: 'General Trivia',
    category: 'trivia',
    description: '5 general knowledge questions with auto-scoring',
    icon: '&#x1F9E0;',
    temperature: 0.3,
    maxTokens: 128,
    prompts: [
      { text: 'What is the capital of Australia? Answer with just the city name.', answer: 'Canberra', autoScore: true },
      { text: 'What planet is known as the Red Planet? Answer with just the planet name.', answer: 'Mars', autoScore: true },
      { text: 'Who painted the Mona Lisa? Answer with just the name.', answer: 'da Vinci', autoScore: true },
      { text: 'What is the largest ocean on Earth? Answer with just the name.', answer: 'Pacific', autoScore: true },
      { text: 'In what year did the Berlin Wall fall? Answer with just the year.', answer: '1989', autoScore: true },
    ],
  },
  {
    id: 'trivia-science',
    name: 'Science Quiz',
    category: 'trivia',
    description: '5 science questions with auto-scoring',
    icon: '&#x1F52C;',
    temperature: 0.3,
    maxTokens: 128,
    prompts: [
      { text: 'What is the chemical symbol for gold? Answer with just the symbol.', answer: 'Au', autoScore: true },
      { text: 'How many bones are in the adult human body? Answer with just the number.', answer: '206', autoScore: true },
      { text: 'What gas do plants absorb from the atmosphere? Answer briefly.', answer: 'carbon dioxide', autoScore: true },
      { text: 'What is the hardest natural substance on Earth? Answer with one word.', answer: 'diamond', autoScore: true },
      { text: 'What is the closest star to Earth? Answer with just the name.', answer: 'Sun', autoScore: true },
    ],
  },
  {
    id: 'code-simple',
    name: 'Code Challenge',
    category: 'code',
    description: '3 coding tasks judged by human vote',
    icon: '&#x1F4BB;',
    temperature: 0.2,
    maxTokens: 256,
    prompts: [
      { text: 'Write a function to reverse a string. Use any programming language.', autoScore: false },
      { text: 'Write FizzBuzz for numbers 1-15. Print each result on a new line.', autoScore: false },
      { text: 'Write a function to check if a number is prime. Use any language.', autoScore: false },
    ],
  },
  {
    id: 'creative-story',
    name: 'Story Continuation',
    category: 'creative',
    description: '3 creative writing prompts judged by human vote',
    icon: '&#x1F4D6;',
    temperature: 0.9,
    maxTokens: 256,
    prompts: [
      { text: 'Continue this story in 2-3 sentences: "The last human on Earth sat alone in a room. There was a knock on the door."', autoScore: false },
      { text: 'Write a haiku about a robot learning to feel emotions.', autoScore: false },
      { text: "Describe an alien's first experience of rain in exactly 3 sentences.", autoScore: false },
    ],
  },
  {
    id: 'reasoning-logic',
    name: 'Logic Puzzles',
    category: 'reasoning',
    description: '3 logic puzzles with auto-scoring',
    icon: '&#x1F9E9;',
    temperature: 0.3,
    maxTokens: 384,
    prompts: [
      { text: 'If all Bloops are Razzles and all Razzles are Lazzles, are all Bloops definitely Lazzles? Answer yes or no.', answer: 'yes', autoScore: true },
      { text: 'A farmer has 17 sheep. All but 9 die. How many sheep are left? Answer with just the number.', answer: '9', autoScore: true },
      { text: 'What comes next in the sequence: 2, 6, 12, 20, 30, ? Answer with just the number.', answer: '42', autoScore: true },
    ],
  },
  {
    id: 'speed-round',
    name: 'Speed Round',
    category: 'speed',
    description: '5 rapid-fire questions, mix of auto and manual scoring',
    icon: '&#x26A1;',
    temperature: 0.5,
    maxTokens: 32,
    prompts: [
      { text: 'What is 7 x 8? Answer with just the number.', answer: '56', autoScore: true },
      { text: 'Name any color.', autoScore: false },
      { text: 'What is the opposite of "hot"? One word.', answer: 'cold', autoScore: true },
      { text: 'Say something funny in under 10 words.', autoScore: false },
      { text: 'What is 144 / 12? Answer with just the number.', answer: '12', autoScore: true },
    ],
  },
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

    res.json(match);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    arenaState.isRunning = false;
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

  const validParticipant = match.results && match.results.some(r => r.participantId === winnerId);
  if (!validParticipant) {
    return res.status(400).json({ error: 'winnerId is not a participant in this match' });
  }

  match.winnerId = winnerId;
  res.json({ success: true, match });
});

// DELETE /api/arena/matches - clear history
router.delete('/matches', (req, res) => {
  arenaState.matches = [];
  res.json({ success: true });
});

// --- Challenge endpoints ---

// GET /api/arena/challenges - list challenges (summary)
router.get('/challenges', (req, res) => {
  res.json(challenges.map(({ id, name, category, description, icon, prompts, temperature, maxTokens }) => ({
    id, name, category, description, icon,
    promptCount: prompts.length,
    temperature, maxTokens,
  })));
});

// GET /api/arena/challenges/:id - full challenge with prompts
router.get('/challenges/:id', (req, res) => {
  const challenge = challenges.find(c => c.id === req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
  res.json(challenge);
});

// POST /api/arena/challenge - run a challenge match
router.post('/challenge', async (req, res) => {
  if (arenaState.isRunning) {
    return res.status(400).json({ error: 'A match is already running' });
  }

  const { challengeId, participants: participantIds } = req.body;

  if (!challengeId) {
    return res.status(400).json({ error: 'challengeId is required' });
  }

  const challenge = challenges.find(c => c.id === challengeId);
  if (!challenge) {
    return res.status(404).json({ error: 'Challenge not found' });
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

    const rounds = [];
    const scores = {};

    // Initialize scores
    for (const p of selected) {
      scores[p.id] = { name: p.name, correct: 0, totalTime: 0, totalTokensPerSecond: 0, rounds: 0 };
    }

    // Run each prompt sequentially
    for (const prompt of challenge.prompts) {
      const config = { temperature: challenge.temperature, maxTokens: challenge.maxTokens };

      // Run all participants in parallel for this round
      const results = await Promise.all(
        selected.map(p => generateWithTiming(p, prompt.text, config))
      );

      // Auto-score if applicable
      for (const result of results) {
        let correct = null;
        if (prompt.autoScore && prompt.answer && !result.error) {
          const answerPattern = new RegExp('\\b' + prompt.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          correct = answerPattern.test(result.response);
          if (correct) scores[result.participantId].correct++;
        }
        scores[result.participantId].totalTime += result.totalTime;
        scores[result.participantId].totalTokensPerSecond += parseFloat(result.tokensPerSecond || 0);
        scores[result.participantId].rounds++;
        result.correct = correct;
      }

      rounds.push({
        prompt: prompt.text,
        answer: prompt.answer || null,
        autoScore: prompt.autoScore,
        results,
      });
    }

    // Compute average tokens/sec
    for (const id of Object.keys(scores)) {
      scores[id].avgTokensPerSecond = scores[id].rounds > 0
        ? (scores[id].totalTokensPerSecond / scores[id].rounds).toFixed(1)
        : '0';
    }

    const match = {
      id: Date.now().toString(),
      challengeId: challenge.id,
      challengeName: challenge.name,
      category: challenge.category,
      rounds,
      scores,
      createdAt: new Date().toISOString(),
    };

    arenaState.matches.unshift(match);
    if (arenaState.matches.length > 50) {
      arenaState.matches = arenaState.matches.slice(0, 50);
    }

    res.json(match);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    arenaState.isRunning = false;
  }
});

// --- Model management endpoints ---

// GET /api/arena/models - AI templates with deploy status
router.get('/models', async (req, res) => {
  try {
    const aiTemplates = allTemplates.filter(t => t.category === 'AI');
    const installedApps = appManager.getApps();
    const deployments = await k8sClient.listDeployments('default');

    const models = aiTemplates.map(template => {
      // Find deployed instance
      const app = installedApps.find(a => a.templateId === template.id);

      // Check deployment status
      const deployManifest = template.manifests.find(m => m.kind === 'Deployment');
      const deployName = deployManifest?.metadata?.name;
      const deployment = deployments.find(d => d.metadata.name === deployName);

      let status = 'not_deployed';
      if (deployment) {
        const ready = deployment.status?.readyReplicas || 0;
        const desired = deployment.spec?.replicas || 1;
        status = ready >= desired ? 'running' : 'starting';
      }

      // Extract RAM estimate from description
      const ramMatch = template.description.match(/~([\d.]+)\s*GB\s*RAM/i);
      const ramEstimate = ramMatch ? ramMatch[1] + ' GB' : null;

      // Map to arena participant ID
      const participantId = templateToParticipant[template.id] || null;

      return {
        templateId: template.id,
        name: template.name,
        description: template.description,
        icon: template.icon,
        status,
        ramEstimate,
        participantId,
        instanceId: app?.instanceId || null,
      };
    });

    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/arena/models/:templateId/deploy - deploy an AI model
router.post('/models/:templateId/deploy', async (req, res) => {
  try {
    const template = allTemplates.find(t => t.id === req.params.templateId && t.category === 'AI');
    if (!template) {
      return res.status(404).json({ error: 'AI template not found' });
    }

    const instanceId = `${template.id}-${Date.now()}`;
    const results = [];
    const resources = [];

    for (const manifest of template.manifests) {
      try {
        let processed = substituteConfig(JSON.parse(JSON.stringify(manifest)), {});

        // Inject tracking labels
        if (!processed.metadata) processed.metadata = {};
        if (!processed.metadata.labels) processed.metadata.labels = {};
        if (!processed.metadata.annotations) processed.metadata.annotations = {};
        processed.metadata.labels['app.kubernetes.io/managed-by'] = 'k3s-dashboard';
        processed.metadata.annotations['k3s-dashboard/template-id'] = template.id;
        processed.metadata.annotations['k3s-dashboard/instance-id'] = instanceId;

        if (processed.kind === 'Deployment' && processed.spec?.template?.metadata) {
          if (!processed.spec.template.metadata.labels) processed.spec.template.metadata.labels = {};
          processed.spec.template.metadata.labels['app.kubernetes.io/managed-by'] = 'k3s-dashboard';
        }

        // Convert nodePort string to number if present
        if (processed.spec?.ports) {
          for (const port of processed.spec.ports) {
            if (typeof port.nodePort === 'string') {
              port.nodePort = parseInt(port.nodePort, 10);
            }
          }
        }

        const result = await k8sClient.applyManifest(processed);
        results.push({ kind: processed.kind, name: processed.metadata.name, action: result.action });
        resources.push({ kind: processed.kind, name: processed.metadata.name, namespace: processed.metadata.namespace || 'default' });
      } catch (err) {
        results.push({ kind: manifest.kind, name: manifest.metadata.name, action: 'error', error: err.body?.message || err.message });
      }
    }

    if (resources.length > 0) {
      appManager.registerApp({
        templateId: template.id,
        templateName: template.name,
        icon: template.icon,
        namespace: template.manifests[0]?.metadata?.namespace || 'default',
        configValues: {},
        resources,
        instanceId,
      });
    }

    const hasErrors = results.some(r => r.action === 'error');
    res.status(hasErrors ? 207 : 200).json({ template: template.id, instanceId, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/arena/models/:instanceId - teardown a model (preserves PVCs)
router.delete('/models/:instanceId', async (req, res) => {
  try {
    const app = appManager.getApp(req.params.instanceId);
    if (!app) {
      return res.status(404).json({ error: 'App instance not found' });
    }

    // Sort: Service -> Deployment -> ConfigMap, skip PVCs
    const deleteOrder = ['Service', 'Deployment', 'ConfigMap'];
    const sortedResources = [...app.resources].sort((a, b) => {
      const ai = deleteOrder.indexOf(a.kind);
      const bi = deleteOrder.indexOf(b.kind);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const results = [];
    for (const resource of sortedResources) {
      if (resource.kind === 'PersistentVolumeClaim') {
        results.push({ kind: resource.kind, name: resource.name, action: 'preserved' });
        continue;
      }
      try {
        await k8sClient.deleteResource(resource.kind, resource.namespace, resource.name);
        results.push({ kind: resource.kind, name: resource.name, action: 'deleted' });
      } catch (err) {
        if (err.code === 404 || err.statusCode === 404) {
          results.push({ kind: resource.kind, name: resource.name, action: 'already gone' });
        } else {
          results.push({ kind: resource.kind, name: resource.name, action: 'error', error: err.body?.message || err.message });
        }
      }
    }

    appManager.unregisterApp(req.params.instanceId);
    res.json({ instanceId: req.params.instanceId, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/arena/resources - cluster node memory/CPU
router.get('/resources', async (req, res) => {
  try {
    const overview = await k8sClient.getClusterOverview();
    res.json(overview.nodes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
