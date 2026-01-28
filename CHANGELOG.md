# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-28

### Added

- **Dashboard Overview**
  - Cluster health summary (nodes, pods, deployments, namespaces)
  - Per-node CPU and memory usage with progress bars
  - Storage summary (SD card and SSD totals)
  - Quick deploy template cards
  - Recent cluster events

- **Node Management**
  - Detailed node view with metrics
  - Node conditions display
  - Per-node pod listing
  - IP addresses and system info

- **Workload Management**
  - Deployment listing with replica status
  - Pod listing with status, restarts, and node info
  - Scale deployments up/down
  - Delete pods and deployments
  - Namespace filtering

- **Storage Management**
  - Physical storage devices per node (SD cards, SSDs)
  - StorageClass management
  - PersistentVolume and PVC listing
  - SSD StorageClass support (`local-path-ssd`)
  - Delete PVCs

- **Network Monitoring**
  - Node-to-node ping latency
  - Network interface traffic stats (RX/TX rates)
  - Service endpoints health
  - Auto-refresh every 10 seconds

- **Alerting System**
  - 8 built-in alert rules
  - Configurable thresholds
  - Enable/disable rules
  - Auto-check every 60 seconds
  - Dismiss individual alerts
  - Persistent alert storage

- **YAML Deploy**
  - Apply Kubernetes manifests
  - Multi-document YAML support
  - Client-side validation
  - Detailed apply results

- **Pod Logs**
  - Namespace/pod/container selection
  - Configurable line count
  - URL parameter support for direct linking

- **Deployment Templates**
  - Nginx (web server)
  - Redis (caching)
  - PostgreSQL (database)
  - Whoami (testing)
  - Pi-hole (DNS ad-blocking)
  - Homepage (dashboard)
  - Prometheus (metrics)
  - Grafana (visualization)

- **UI/UX**
  - Dark and light theme support
  - Theme toggle with localStorage persistence
  - Responsive design for mobile
  - Real-time updates with auto-refresh

- **Security**
  - Password authentication with bcrypt
  - Session-based auth with secure cookies
  - Security headers (CSP, X-Frame-Options, etc.)
  - Protected system namespaces and deployments

- **Infrastructure**
  - SystemD service file for production
  - Environment-based configuration
  - Structured logging
