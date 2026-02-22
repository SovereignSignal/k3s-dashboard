# K3s Dashboard

A lightweight web dashboard for managing a Raspberry Pi k3s cluster. Built with Node.js, Express, and vanilla JavaScript.

## Features

- **Cluster Overview** — Real-time node status, pod counts, deployments, and resource usage with CPU/memory graphs
- **Node Management** — Detailed per-node view with hardware info, conditions, and resource metrics
- **Workloads** — View, scale, restart, and delete deployments and pods across namespaces
- **Storage** — PersistentVolumes, PersistentVolumeClaims, and StorageClass management
- **Network** — LAN device discovery, service/ingress listing, network scan with Wake-on-LAN support
- **Devices** — Background LAN monitoring with device inventory, status tracking, and custom naming
- **Alerts** — Configurable alerts for node issues, resource usage, pod crashes, and disk pressure
- **Namespaces** — Create, view, and delete Kubernetes namespaces
- **Deploy** — Apply raw YAML manifests or use app templates with configurable parameters
- **Apps** — Manage template-deployed applications with restart, scale, reconfigure, and uninstall
- **Updates** — Rolling OS updates (`apt upgrade`) and k3s version upgrades across all nodes from the UI with live progress tracking
- **Logs** — Real-time pod log viewer with container and tail-line selection
- **AI Arena** — Pit AI models head-to-head with custom prompts or pre-built challenge templates (trivia, code, creative, reasoning, speed); includes model quick-deploy/teardown and cluster resource monitoring
- **LLM Backroom** — AI model deployment templates for running LLMs on the cluster
- **Command Palette** — `Cmd+K` search and `g+key` keyboard navigation shortcuts
- **Dark/Light Theme** — Toggle with preference persistence

## Quick Start

```bash
git clone https://github.com/SovereignSignal/k3s-dashboard.git
cd k3s-dashboard
npm install
cp .env.example .env
```

Generate credentials and add to `.env`:

```bash
# Session secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Password hash
node -e "require('bcrypt').hash('your-password', 12).then(h => console.log(h))"
```

Start the server:

```bash
npm start
```

Open `http://<your-server-ip>:3000` in your browser.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BIND_ADDRESS` | IP to bind to | `192.168.50.22` |
| `SESSION_SECRET` | Session encryption key | Required |
| `PASSWORD_HASH` | Bcrypt password hash | Required |
| `SESSION_TTL_HOURS` | Session timeout | `8` |

## Running as a Service

```bash
sudo cp k3s-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now k3s-dashboard
```

## Architecture

```
k3s-dashboard/
├── server.js                  # Express app entry point
├── config.js                  # Environment configuration
├── services/
│   ├── k8s-client.js          # Kubernetes API wrapper (nodes, pods, deployments, drain/cordon)
│   ├── metrics-collector.js   # Background metrics collection and history
│   ├── device-monitor.js      # Background LAN device scanning
│   ├── app-manager.js         # Template-deployed app lifecycle management
│   └── update-manager.js      # Rolling OS/k3s update orchestration via SSH
├── routes/api/
│   ├── index.js               # API router (auth gating)
│   ├── cluster.js, nodes.js, pods.js, deployments.js, ...
│   ├── apps.js                # App management endpoints
│   ├── arena.js               # AI Arena: matches, challenges, model deploy/teardown
│   └── updates.js             # Update check/start/status/reset endpoints
├── public/
│   ├── *.html                 # Page templates (13 pages)
│   ├── js/api.js              # Shared client: API wrapper, toasts, command palette, sidebar
│   ├── js/*.js                # Per-page logic
│   └── css/style.css          # All styles (dark/light themes)
├── templates/                 # App deployment templates (YAML with {{PLACEHOLDER}} syntax)
└── data/                      # Persisted state (device-monitor.json, update-state.json, etc.)
```

### Updates System

The updates feature performs rolling operations across the 4-node cluster:

- **OS Updates**: Workers first, then server. Each node is cordoned, drained, upgraded via `apt upgrade` over SSH, then uncordoned.
- **K3s Upgrades**: Server first (via install script), then agents (binary replacement to avoid spurious service files). Includes waiting for API server recovery.
- **Progress Tracking**: Per-node step indicators with live log output, adaptive polling (2s active, 30s idle), state persisted to disk.

SSH must be configured with key-based auth (`BatchMode=yes`) from the dashboard host to all nodes.

### AI Arena

The arena lets you compare AI models running on the cluster:

- **Custom Battles**: Free-form prompts sent to 2+ models in parallel, with response timing, token/s metrics, and manual voting.
- **Challenge Templates**: 6 pre-built challenge sets across categories (trivia, science, code, creative, reasoning, speed). Trivia/logic/speed challenges use auto-scoring via word-boundary matching; code/creative use manual voting.
- **Model Management**: Deploy and tear down Ollama AI models directly from the arena page. Reuses the template system and app manager. PVCs are preserved on teardown for fast re-deploy.
- **Cluster Resources**: Collapsible per-node RAM usage bar to help decide which models fit on the cluster.

**API Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/arena/participants` | Discover online Ollama endpoints |
| `POST` | `/api/arena/match` | Run a custom battle |
| `GET` | `/api/arena/challenges` | List challenge templates |
| `POST` | `/api/arena/challenge` | Run a challenge (sequential rounds, parallel participants) |
| `GET` | `/api/arena/models` | AI templates with deploy status and RAM estimates |
| `POST` | `/api/arena/models/:id/deploy` | Deploy an AI model |
| `DELETE` | `/api/arena/models/:id` | Tear down a model (preserves PVCs) |
| `GET` | `/api/arena/resources` | Cluster node memory/CPU |

## Tech Stack

- **Backend:** Node.js, Express 5
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Kubernetes:** @kubernetes/client-node

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Command palette |
| `g h` | Go to Overview |
| `g n` | Go to Nodes |
| `g w` | Go to Workloads |
| `g s` | Go to Storage |
| `g e` | Go to Network |
| `g i` | Go to Devices |
| `g a` | Go to Alerts |
| `g d` | Go to Deploy |
| `g p` | Go to Apps |
| `g u` | Go to Updates |
| `g l` | Go to Logs |
| `?` | Show keyboard help |

## License

MIT
