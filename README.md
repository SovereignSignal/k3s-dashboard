# K3s Dashboard

A lightweight web dashboard for managing a Raspberry Pi k3s cluster. Built with Node.js, Express, and vanilla JavaScript - no build step required.

![Dashboard Overview](docs/screenshots/overview.png)

## Features

- **Cluster Overview** - Real-time view of nodes, pods, deployments, and cluster health
- **Node Management** - CPU/memory metrics, conditions, and per-node pod listing
- **Workload Management** - View, scale, and delete deployments and pods
- **Storage Management** - Monitor SD cards and SSDs, manage StorageClasses and PVCs
- **Network Monitoring** - Node connectivity, interface traffic stats, service endpoints
- **Alerting System** - Configurable alerts for node issues, resource usage, pod crashes
- **YAML Deploy** - Apply Kubernetes manifests directly from the UI
- **Pod Logs** - Stream logs from any pod/container
- **Quick Deploy Templates** - One-click deployment of common applications
- **Dark/Light Theme** - Toggle between themes with preference persistence

## Quick Start

### Prerequisites

- Node.js 18+
- k3s cluster with `kubectl` access configured
- SSH access between nodes (for network/storage monitoring)

### Installation

```bash
# Clone the repository
git clone https://github.com/SovereignSignal/k3s-dashboard.git
cd k3s-dashboard

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Generate a session secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Copy the output to SESSION_SECRET in .env

# Generate a password hash
node -e "require('bcrypt').hash('your-password-here', 12).then(h => console.log(h))"
# Copy the output to PASSWORD_HASH in .env

# Edit .env with your settings
nano .env

# Start the server
npm start
```

### Access

Open `http://<your-server-ip>:3000` in your browser.

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BIND_ADDRESS` | IP address to bind to | `192.168.50.22` |
| `SESSION_SECRET` | Secret for session encryption (generate with crypto) | Required |
| `PASSWORD_HASH` | Bcrypt hash of dashboard password | Required |
| `SESSION_TTL_HOURS` | Session timeout in hours | `8` |
| `KUBECONFIG_PATH` | Path to kubeconfig file (empty for default) | `~/.kube/config` |

### Generating Credentials

```bash
# Generate session secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate password hash (replace 'mypassword' with your password)
node -e "require('bcrypt').hash('mypassword', 12).then(h => console.log(h))"
```

## Production Deployment

### SystemD Service

Install as a system service for automatic startup:

```bash
# Copy service file
sudo cp k3s-dashboard.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable k3s-dashboard
sudo systemctl start k3s-dashboard

# Check status
sudo systemctl status k3s-dashboard

# View logs
sudo journalctl -u k3s-dashboard -f
```

### Service Management

```bash
sudo systemctl start k3s-dashboard    # Start
sudo systemctl stop k3s-dashboard     # Stop
sudo systemctl restart k3s-dashboard  # Restart
sudo systemctl status k3s-dashboard   # Status
```

## Storage Classes

The dashboard supports multiple storage classes for different storage types:

| StorageClass | Path | Nodes | Use Case |
|--------------|------|-------|----------|
| `local-path` (default) | `/var/lib/rancher/k3s/storage` | All | General storage on SD cards |
| `local-path-ssd` | `/mnt/ssd/k3s-storage` | SSD-equipped nodes | High-performance storage |

### Setting Up SSD Storage

If you have nodes with SSDs:

```bash
# Label SSD-equipped nodes
kubectl label node pi1 storage.kubernetes.io/ssd=true
kubectl label node pi4 storage.kubernetes.io/ssd=true

# Create SSD directories on those nodes
sudo mkdir -p /mnt/ssd/k3s-storage
sudo chmod 755 /mnt/ssd/k3s-storage

# Create the SSD StorageClass
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path-ssd
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowedTopologies:
- matchLabelExpressions:
  - key: storage.kubernetes.io/ssd
    values:
    - "true"
EOF
```

## Deployment Templates

Quick-deploy templates are available for common applications:

| Template | Description | Storage |
|----------|-------------|---------|
| Nginx | Web server (2 replicas) | None |
| Redis | In-memory cache | None |
| PostgreSQL | Relational database | SSD (10Gi) |
| Whoami | Test service (3 replicas) | None |
| Pi-hole | Ad-blocking DNS | SSD (1Gi) |
| Homepage | Customizable dashboard | Local (100Mi) |
| Prometheus | Metrics collection | SSD (20Gi) |
| Grafana | Visualization | SSD (5Gi) |

## Alert Rules

Built-in alert rules monitor cluster health:

| Rule | Severity | Description |
|------|----------|-------------|
| Node Not Ready | Critical | Node fails Ready condition |
| High CPU Usage | Warning | CPU > 85% threshold |
| High Memory Usage | Warning | Memory > 85% threshold |
| Node Unreachable | Critical | Node fails ping test |
| Pod CrashLoopBackOff | Critical | Pod in crash loop |
| High Pod Restarts | Warning | Pod restarts > 5 |
| PVC Pending | Warning | PVC stuck in Pending |
| Endpoint Not Ready | Warning | Service has no ready endpoints |

Alerts auto-check every 60 seconds. Rules can be enabled/disabled from the Alerts page.

## API Reference

All API endpoints require authentication (except `/api/auth/*`).

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with password |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/status` | Check auth status |

### Cluster

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cluster/overview` | Cluster summary stats |
| GET | `/api/cluster/events` | Recent cluster events |

### Nodes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/nodes` | List all nodes with metrics |
| GET | `/api/nodes/:name` | Node details with pods |

### Pods

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pods` | List pods (optional `?namespace=`) |
| DELETE | `/api/pods/:ns/:name` | Delete a pod |
| GET | `/api/pods/:ns/:name/logs` | Get pod logs |

### Deployments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/deployments` | List deployments |
| POST | `/api/deployments` | Create deployment |
| DELETE | `/api/deployments/:ns/:name` | Delete deployment |
| POST | `/api/deployments/:ns/:name/scale` | Scale deployment |

### Namespaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/namespaces` | List namespaces |
| POST | `/api/namespaces` | Create namespace |
| DELETE | `/api/namespaces/:name` | Delete namespace |

### Storage

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/storage/classes` | List StorageClasses |
| GET | `/api/storage/pv` | List PersistentVolumes |
| GET | `/api/storage/pvc` | List PersistentVolumeClaims |
| GET | `/api/storage/nodes` | Node storage devices |
| DELETE | `/api/storage/pvc/:ns/:name` | Delete PVC |

### Network

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/network/stats` | Interface traffic stats |
| GET | `/api/network/ping` | Node ping latencies |
| GET | `/api/network/endpoints` | Service endpoints |
| GET | `/api/network/services` | Cluster services |

### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alerts` | Active alerts |
| POST | `/api/alerts/check` | Run checks now |
| GET | `/api/alerts/rules` | List alert rules |
| PATCH | `/api/alerts/rules/:id` | Update rule |
| DELETE | `/api/alerts/:index` | Dismiss alert |

### Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | List templates |
| GET | `/api/templates/:id` | Template details |
| POST | `/api/templates/:id/deploy` | Deploy template |

### Apply

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/apply` | Apply YAML manifest |

## Project Structure

```
k3s-dashboard/
├── server.js                 # Express app entry point
├── package.json
├── .env.example              # Environment template
├── k3s-dashboard.service     # SystemD unit file
├── config/
│   └── index.js              # Configuration loader
├── middleware/
│   ├── auth.js               # Session authentication
│   └── error-handler.js      # Global error handler
├── routes/api/
│   ├── index.js              # API router
│   ├── auth.js               # Authentication
│   ├── cluster.js            # Cluster overview
│   ├── nodes.js              # Node management
│   ├── pods.js               # Pod management
│   ├── deployments.js        # Deployment management
│   ├── namespaces.js         # Namespace management
│   ├── storage.js            # Storage management
│   ├── network.js            # Network monitoring
│   ├── alerts.js             # Alerting system
│   ├── templates.js          # Deployment templates
│   └── apply.js              # YAML apply
├── services/
│   └── k8s-client.js         # Kubernetes API wrapper
├── utils/
│   └── logger.js             # Logging utility
└── public/
    ├── login.html
    ├── index.html            # Overview
    ├── nodes.html
    ├── workloads.html
    ├── storage.html
    ├── network.html
    ├── alerts.html
    ├── namespaces.html
    ├── deploy.html
    ├── logs.html
    ├── css/style.css         # Dark/light themes
    └── js/
        ├── api.js            # Shared utilities
        ├── dashboard.js
        ├── nodes.js
        ├── workloads.js
        ├── storage.js
        ├── network.js
        ├── alerts.js
        ├── namespaces.js
        ├── deploy.js
        └── logs.js
```

## Security

- **Password Authentication** - Bcrypt-hashed passwords
- **Session Management** - HttpOnly, SameSite=Strict cookies
- **Security Headers** - CSP, X-Frame-Options, X-Content-Type-Options
- **Protected Resources** - System namespaces and deployments cannot be deleted
- **Bind Address** - Configure to bind to specific interface

### Protected Resources

The following cannot be deleted from the UI:

**Namespaces:**
- kube-system
- kube-public
- kube-node-lease

**Deployments (by prefix):**
- coredns
- local-path-provisioner
- metrics-server
- traefik

## Development

```bash
# Run with auto-reload
npm run dev

# Or manually
node --watch server.js
```

## Tech Stack

- **Backend:** Node.js, Express 5
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Kubernetes Client:** @kubernetes/client-node
- **Authentication:** express-session, bcrypt
- **Styling:** CSS custom properties (dark/light themes)

## License

MIT

## Contributing

Contributions welcome! Please open an issue or pull request.
