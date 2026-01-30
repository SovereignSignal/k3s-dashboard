# K3s Dashboard

A lightweight web dashboard for managing a Raspberry Pi k3s cluster. Built with Node.js, Express, and vanilla JavaScript.

## Features

- **Cluster Overview** - Real-time nodes, pods, deployments, and health status
- **Node & Workload Management** - View, scale, and delete resources
- **Storage & Network Monitoring** - SD/SSD metrics, traffic stats, connectivity
- **Alerting** - Configurable alerts for node issues, resource usage, pod crashes
- **YAML Deploy** - Apply manifests and quick-deploy common apps
- **Dark/Light Theme** - Toggle with preference persistence

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

## Tech Stack

- **Backend:** Node.js, Express 5
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Kubernetes:** @kubernetes/client-node

## License

MIT
