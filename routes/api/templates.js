const { Router } = require('express');
const k8s = require('../../services/k8s-client');
const appManager = require('../../services/app-manager');

const router = Router();

// Helper to inject tracking labels/annotations into manifests
function injectLabels(manifest, templateId, instanceId) {
  if (!manifest.metadata) manifest.metadata = {};
  if (!manifest.metadata.labels) manifest.metadata.labels = {};
  if (!manifest.metadata.annotations) manifest.metadata.annotations = {};

  manifest.metadata.labels['app.kubernetes.io/managed-by'] = 'k3s-dashboard';
  manifest.metadata.annotations['k3s-dashboard/template-id'] = templateId;
  manifest.metadata.annotations['k3s-dashboard/instance-id'] = instanceId;

  // Also inject into pod template if this is a Deployment
  if (manifest.kind === 'Deployment' && manifest.spec?.template?.metadata) {
    if (!manifest.spec.template.metadata.labels) manifest.spec.template.metadata.labels = {};
    manifest.spec.template.metadata.labels['app.kubernetes.io/managed-by'] = 'k3s-dashboard';
  }

  return manifest;
}

// Helper to substitute {{PLACEHOLDER}} values in manifest objects
function substituteConfig(obj, values) {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      values.hasOwnProperty(key) ? values[key] : `{{${key}}}`
    );
  }
  if (Array.isArray(obj)) return obj.map(item => substituteConfig(item, values));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteConfig(value, values);
    }
    return result;
  }
  return obj;
}

// Deployment templates - useful apps for a home/lab k3s cluster
const templates = [
  {
    id: 'nginx',
    name: 'Nginx',
    category: 'Web Server',
    description: 'Lightweight web server and reverse proxy',
    icon: '🌐',
    manifests: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'nginx', namespace: 'default' },
        spec: {
          replicas: 2,
          selector: { matchLabels: { app: 'nginx' } },
          template: {
            metadata: { labels: { app: 'nginx' } },
            spec: {
              containers: [{
                name: 'nginx',
                image: 'nginx:alpine',
                ports: [{ containerPort: 80 }],
                resources: {
                  requests: { cpu: '50m', memory: '64Mi' },
                  limits: { cpu: '200m', memory: '128Mi' },
                },
              }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'nginx', namespace: 'default' },
        spec: {
          selector: { app: 'nginx' },
          ports: [{ port: 80, targetPort: 80 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'Database',
    description: 'In-memory data store for caching',
    icon: '🔴',
    manifests: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'redis', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'redis' } },
          template: {
            metadata: { labels: { app: 'redis' } },
            spec: {
              containers: [{
                name: 'redis',
                image: 'redis:7-alpine',
                ports: [{ containerPort: 6379 }],
                resources: {
                  requests: { cpu: '50m', memory: '64Mi' },
                  limits: { cpu: '200m', memory: '256Mi' },
                },
              }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'redis', namespace: 'default' },
        spec: {
          selector: { app: 'redis' },
          ports: [{ port: 6379, targetPort: 6379 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'Database',
    description: 'Relational database with SSD storage',
    icon: '🐘',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'postgres-data', namespace: 'default' },
        spec: {
          storageClassName: 'local-path-ssd',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'postgres', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'postgres' } },
          template: {
            metadata: { labels: { app: 'postgres' } },
            spec: {
              containers: [{
                name: 'postgres',
                image: 'postgres:16-alpine',
                ports: [{ containerPort: 5432 }],
                env: [
                  { name: 'POSTGRES_USER', value: 'admin' },
                  { name: 'POSTGRES_PASSWORD', value: 'changeme' },
                  { name: 'POSTGRES_DB', value: 'app' },
                ],
                volumeMounts: [{ name: 'data', mountPath: '/var/lib/postgresql/data' }],
                resources: {
                  requests: { cpu: '100m', memory: '256Mi' },
                  limits: { cpu: '500m', memory: '512Mi' },
                },
              }],
              volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'postgres-data' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'postgres', namespace: 'default' },
        spec: {
          selector: { app: 'postgres' },
          ports: [{ port: 5432, targetPort: 5432 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'whoami',
    name: 'Whoami',
    category: 'Testing',
    description: 'Simple HTTP service that returns request info',
    icon: '🔍',
    manifests: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'whoami', namespace: 'default' },
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: 'whoami' } },
          template: {
            metadata: { labels: { app: 'whoami' } },
            spec: {
              containers: [{
                name: 'whoami',
                image: 'traefik/whoami:latest',
                ports: [{ containerPort: 80 }],
                resources: {
                  requests: { cpu: '10m', memory: '16Mi' },
                  limits: { cpu: '50m', memory: '32Mi' },
                },
              }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'whoami', namespace: 'default' },
        spec: {
          selector: { app: 'whoami' },
          ports: [{ port: 80, targetPort: 80 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'pi-hole',
    name: 'Pi-hole',
    category: 'Networking',
    description: 'Network-wide ad blocking DNS server',
    icon: '🕳️',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'pihole-config', namespace: 'default' },
        spec: {
          storageClassName: 'local-path-ssd',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '1Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'pihole', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'pihole' } },
          template: {
            metadata: { labels: { app: 'pihole' } },
            spec: {
              containers: [{
                name: 'pihole',
                image: 'pihole/pihole:latest',
                ports: [
                  { containerPort: 80, name: 'http' },
                  { containerPort: 53, name: 'dns-tcp', protocol: 'TCP' },
                  { containerPort: 53, name: 'dns-udp', protocol: 'UDP' },
                ],
                env: [
                  { name: 'TZ', value: 'America/Los_Angeles' },
                  { name: 'WEBPASSWORD', value: 'changeme' },
                ],
                volumeMounts: [{ name: 'config', mountPath: '/etc/pihole' }],
                resources: {
                  requests: { cpu: '100m', memory: '128Mi' },
                  limits: { cpu: '500m', memory: '512Mi' },
                },
              }],
              volumes: [{ name: 'config', persistentVolumeClaim: { claimName: 'pihole-config' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'pihole-web', namespace: 'default' },
        spec: {
          selector: { app: 'pihole' },
          ports: [{ port: 80, targetPort: 80 }],
          type: 'ClusterIP',
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'pihole-dns', namespace: 'default' },
        spec: {
          selector: { app: 'pihole' },
          ports: [
            { port: 53, targetPort: 53, protocol: 'TCP', name: 'dns-tcp' },
            { port: 53, targetPort: 53, protocol: 'UDP', name: 'dns-udp' },
          ],
          type: 'LoadBalancer',
        },
      },
    ],
  },
  {
    id: 'homepage',
    name: 'Homepage',
    category: 'Dashboard',
    description: 'Customizable application dashboard',
    icon: '🏠',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'homepage-config', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '100Mi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'homepage', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'homepage' } },
          template: {
            metadata: { labels: { app: 'homepage' } },
            spec: {
              containers: [{
                name: 'homepage',
                image: 'ghcr.io/gethomepage/homepage:latest',
                ports: [{ containerPort: 3000 }],
                volumeMounts: [{ name: 'config', mountPath: '/app/config' }],
                resources: {
                  requests: { cpu: '50m', memory: '128Mi' },
                  limits: { cpu: '200m', memory: '256Mi' },
                },
              }],
              volumes: [{ name: 'config', persistentVolumeClaim: { claimName: 'homepage-config' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'homepage', namespace: 'default' },
        spec: {
          selector: { app: 'homepage' },
          ports: [{ port: 3000, targetPort: 3000 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    category: 'Monitoring',
    description: 'Metrics collection and alerting',
    icon: '📊',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'prometheus-data', namespace: 'default' },
        spec: {
          storageClassName: 'local-path-ssd',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '20Gi' } },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'prometheus-config', namespace: 'default' },
        data: {
          'prometheus.yml': `global:
  scrape_interval: 30s
  evaluation_interval: 30s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'kubernetes-nodes'
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      - source_labels: [__address__]
        regex: '(.+):10250'
        replacement: '\${1}:9100'
        target_label: __address__
`,
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'prometheus', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'prometheus' } },
          template: {
            metadata: { labels: { app: 'prometheus' } },
            spec: {
              serviceAccountName: 'default',
              containers: [{
                name: 'prometheus',
                image: 'prom/prometheus:latest',
                args: [
                  '--config.file=/etc/prometheus/prometheus.yml',
                  '--storage.tsdb.path=/prometheus',
                  '--storage.tsdb.retention.time=30d',
                ],
                ports: [{ containerPort: 9090 }],
                volumeMounts: [
                  { name: 'config', mountPath: '/etc/prometheus' },
                  { name: 'data', mountPath: '/prometheus' },
                ],
                resources: {
                  requests: { cpu: '100m', memory: '256Mi' },
                  limits: { cpu: '500m', memory: '512Mi' },
                },
              }],
              volumes: [
                { name: 'config', configMap: { name: 'prometheus-config' } },
                { name: 'data', persistentVolumeClaim: { claimName: 'prometheus-data' } },
              ],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'prometheus', namespace: 'default' },
        spec: {
          selector: { app: 'prometheus' },
          ports: [{ port: 9090, targetPort: 9090 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'AI',
    description: 'Local LLM inference server (bring your own model)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '30Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama' } },
          template: {
            metadata: { labels: { app: 'ollama' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '2Gi' },
                  limits: { cpu: '4', memory: '3Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                ],
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama', namespace: 'default' },
        spec: {
          selector: { app: 'ollama' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-tinyllama',
    name: 'Ollama + TinyLlama',
    category: 'AI',
    description: 'TinyLlama 1.1B - Fast and lightweight (~1GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-tinyllama-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-tinyllama', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-tinyllama', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-tinyllama', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '1Gi' },
                  limits: { cpu: '4', memory: '2Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'tinyllama' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull tinyllama &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-tinyllama-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-tinyllama', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-tinyllama' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-qwen',
    name: 'Ollama + Qwen3 1.7B',
    category: 'AI',
    description: 'Qwen3 1.7B - Best quality for size (~1.4GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-qwen-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-qwen', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-qwen', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-qwen', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '2Gi' },
                  limits: { cpu: '4', memory: '3Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'qwen3:1.7b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull qwen3:1.7b &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-qwen-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-qwen', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-qwen' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-phi',
    name: 'Ollama + Phi-4 Mini',
    category: 'AI',
    description: 'Phi-4 Mini 3.8B - Strong math/coding, best on idle nodes (~2.5GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-phi-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-phi', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-phi', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-phi', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '2560Mi' },
                  limits: { cpu: '4', memory: '3584Mi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'phi4-mini' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull phi4-mini &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-phi-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-phi', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-phi' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-gemma',
    name: 'Ollama + Gemma 3 1B',
    category: 'AI',
    description: 'Google Gemma 3 1B - Beats Gemma 2 at half the size (~0.8GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-gemma-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-gemma', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-gemma', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-gemma', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '768Mi' },
                  limits: { cpu: '4', memory: '1536Mi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'gemma3:1b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull gemma3:1b &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-gemma-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-gemma', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-gemma' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-deepseek',
    name: 'Ollama + DeepSeek-R1 1.5B',
    category: 'AI',
    description: 'DeepSeek-R1 1.5B - Chain-of-thought reasoning (~2GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-deepseek-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-deepseek', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-deepseek', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-deepseek', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '2Gi' },
                  limits: { cpu: '4', memory: '3Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'deepseek-r1:1.5b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull deepseek-r1:1.5b &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-deepseek-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-deepseek', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-deepseek' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-qwen3-06b',
    name: 'Ollama + Qwen3 0.6B',
    category: 'AI',
    description: 'Qwen3 0.6B - Ultra-fast responses (~0.5GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-qwen3-06b-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-qwen3-06b', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-qwen3-06b', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-qwen3-06b', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '512Mi' },
                  limits: { cpu: '4', memory: '1Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'qwen3:0.6b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull qwen3:0.6b &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-qwen3-06b-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-qwen3-06b', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-qwen3-06b' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-smollm2',
    name: 'Ollama + SmolLM2 1.7B',
    category: 'AI',
    description: 'SmolLM2 1.7B - HuggingFace edge champion (~1.2GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-smollm2-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-smollm2', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-smollm2', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-smollm2', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '1Gi' },
                  limits: { cpu: '4', memory: '2Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'smollm2:1.7b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull smollm2:1.7b &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-smollm2-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-smollm2', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-smollm2' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-llama32',
    name: 'Ollama + Llama 3.2 1B',
    category: 'AI',
    description: 'Llama 3.2 1B - Meta\'s compact all-rounder (~1.3GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-llama32-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-llama32', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-llama32', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-llama32', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '1Gi' },
                  limits: { cpu: '4', memory: '2Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'llama3.2:1b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull llama3.2:1b &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-llama32-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-llama32', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-llama32' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-moondream',
    name: 'Ollama + Moondream 1.8B',
    category: 'AI',
    description: 'Moondream 1.8B - Vision model, understands images (~1.5GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-moondream-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-moondream', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-moondream', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-moondream', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '1Gi' },
                  limits: { cpu: '4', memory: '2Gi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'moondream:1.8b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull moondream:1.8b &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-moondream-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-moondream', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-moondream' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'ollama-gemma3-270m',
    name: 'Ollama + Gemma 3 270M',
    category: 'AI',
    description: 'Gemma 3 270M - Instant responses, minimal resources (~0.3GB RAM)',
    icon: '🦙',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'ollama-gemma3-270m-models', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '5Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'ollama-gemma3-270m', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'ollama-gemma3-270m', 'llm-backroom': 'participant' } },
          template: {
            metadata: { labels: { app: 'ollama-gemma3-270m', 'llm-backroom': 'participant' } },
            spec: {
              containers: [{
                name: 'ollama',
                image: 'ollama/ollama:latest',
                ports: [{ containerPort: 11434 }],
                volumeMounts: [{ name: 'models', mountPath: '/root/.ollama' }],
                resources: {
                  requests: { cpu: '500m', memory: '256Mi' },
                  limits: { cpu: '4', memory: '768Mi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'gemma3:270m' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull gemma3:270m &'],
                    },
                  },
                },
              }],
              volumes: [{ name: 'models', persistentVolumeClaim: { claimName: 'ollama-gemma3-270m-models' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'ollama-gemma3-270m', namespace: 'default' },
        spec: {
          selector: { app: 'ollama-gemma3-270m' },
          ports: [{ port: 11434, targetPort: 11434 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'grafana',
    name: 'Grafana',
    category: 'Monitoring',
    description: 'Visualization and dashboards',
    icon: '📈',
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'grafana-data', namespace: 'default' },
        spec: {
          storageClassName: 'local-path-ssd',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '5Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'grafana', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'grafana' } },
          template: {
            metadata: { labels: { app: 'grafana' } },
            spec: {
              securityContext: { fsGroup: 472 },
              containers: [{
                name: 'grafana',
                image: 'grafana/grafana:latest',
                ports: [{ containerPort: 3000 }],
                env: [
                  { name: 'GF_SECURITY_ADMIN_PASSWORD', value: 'changeme' },
                ],
                volumeMounts: [{ name: 'data', mountPath: '/var/lib/grafana' }],
                resources: {
                  requests: { cpu: '100m', memory: '128Mi' },
                  limits: { cpu: '500m', memory: '512Mi' },
                },
              }],
              volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'grafana-data' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'grafana', namespace: 'default' },
        spec: {
          selector: { app: 'grafana' },
          ports: [{ port: 3000, targetPort: 3000 }],
          type: 'ClusterIP',
        },
      },
    ],
  },
  {
    id: 'minecraft',
    name: 'Minecraft Java Server',
    category: 'Gaming',
    description: 'Paper server with auto-updates and persistent world',
    icon: '🎮',
    config: [
      {
        id: 'SERVER_NAME',
        label: 'Server Name (MOTD)',
        type: 'text',
        default: 'K3s Minecraft',
      },
      {
        id: 'MEMORY',
        label: 'Memory',
        type: 'select',
        default: '1G',
        options: [
          { value: '512M', label: '512 MB (1-2 players)' },
          { value: '1G', label: '1 GB (3-5 players)' },
          { value: '2G', label: '2 GB (5-10 players)' },
        ],
      },
      {
        id: 'DIFFICULTY',
        label: 'Difficulty',
        type: 'select',
        default: 'normal',
        options: ['peaceful', 'easy', 'normal', 'hard'],
      },
      {
        id: 'GAMEMODE',
        label: 'Game Mode',
        type: 'select',
        default: 'survival',
        options: ['survival', 'creative', 'adventure'],
      },
      {
        id: 'MAX_PLAYERS',
        label: 'Max Players',
        type: 'select',
        default: '10',
        options: ['5', '10', '20'],
      },
      {
        id: 'VIEW_DISTANCE',
        label: 'View Distance',
        type: 'select',
        default: '10',
        options: [
          { value: '6', label: '6 chunks (better perf)' },
          { value: '8', label: '8 chunks' },
          { value: '10', label: '10 chunks (default)' },
          { value: '12', label: '12 chunks' },
        ],
      },
      {
        id: 'NODE_PORT',
        label: 'Port',
        type: 'select',
        default: '30565',
        options: ['30565', '30566', '30567', '30568'],
        hint: 'Connect via any-node-ip:port',
      },
    ],
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'minecraft-data', namespace: 'default' },
        spec: {
          storageClassName: 'local-path',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'minecraft', namespace: 'default' },
        spec: {
          replicas: 1,
          strategy: { type: 'Recreate' },
          selector: { matchLabels: { app: 'minecraft' } },
          template: {
            metadata: { labels: { app: 'minecraft' } },
            spec: {
              containers: [{
                name: 'minecraft',
                image: 'itzg/minecraft-server:latest',
                ports: [{ containerPort: 25565, name: 'minecraft' }],
                env: [
                  { name: 'EULA', value: 'TRUE' },
                  { name: 'TYPE', value: 'PAPER' },
                  { name: 'VERSION', value: 'LATEST' },
                  { name: 'MOTD', value: '{{SERVER_NAME}}' },
                  { name: 'MEMORY', value: '{{MEMORY}}' },
                  { name: 'DIFFICULTY', value: '{{DIFFICULTY}}' },
                  { name: 'MODE', value: '{{GAMEMODE}}' },
                  { name: 'MAX_PLAYERS', value: '{{MAX_PLAYERS}}' },
                  { name: 'VIEW_DISTANCE', value: '{{VIEW_DISTANCE}}' },
                ],
                volumeMounts: [{ name: 'data', mountPath: '/data' }],
                resources: {
                  requests: { cpu: '500m', memory: '{{CONTAINER_MEMORY}}' },
                  limits: { cpu: '2', memory: '{{CONTAINER_MEMORY}}' },
                },
                readinessProbe: {
                  exec: { command: ['mc-health'] },
                  initialDelaySeconds: 120,
                  periodSeconds: 10,
                  failureThreshold: 5,
                },
                livenessProbe: {
                  exec: { command: ['mc-health'] },
                  initialDelaySeconds: 300,
                  periodSeconds: 30,
                  failureThreshold: 5,
                },
              }],
              volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'minecraft-data' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'minecraft', namespace: 'default' },
        spec: {
          selector: { app: 'minecraft' },
          ports: [{ port: 25565, targetPort: 25565, nodePort: '{{NODE_PORT}}' }],
          type: 'NodePort',
        },
      },
    ],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    category: 'Agent',
    description: 'Autonomous AI agent - connects to messaging platforms',
    icon: '🦞',
    config: [
      {
        id: 'LLM_PROVIDER',
        label: 'LLM Provider',
        type: 'select',
        default: 'ollama',
        options: ['ollama', 'anthropic', 'openai'],
      },
      {
        id: 'LLM_API_KEY',
        label: 'API Key (cloud providers only)',
        type: 'text',
        default: '',
      },
      {
        id: 'OLLAMA_URL',
        label: 'Ollama URL',
        type: 'text',
        default: 'http://ollama.default.svc.cluster.local:11434',
      },
      {
        id: 'NODE_PORT',
        label: 'Port',
        type: 'select',
        default: '30580',
        options: ['30580', '30581', '30582'],
        hint: 'Access via any-node-ip:port',
      },
    ],
    manifests: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'openclaw-data', namespace: 'default' },
        spec: {
          storageClassName: 'local-path-ssd',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '5Gi' } },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'openclaw', namespace: 'default' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'openclaw' } },
          template: {
            metadata: { labels: { app: 'openclaw' } },
            spec: {
              containers: [{
                name: 'openclaw',
                image: 'ghcr.io/openclaw/openclaw:latest',
                ports: [{ containerPort: 18789 }],
                env: [
                  { name: 'LLM_PROVIDER', value: '{{LLM_PROVIDER}}' },
                  { name: 'LLM_API_KEY', value: '{{LLM_API_KEY}}' },
                  { name: 'OLLAMA_URL', value: '{{OLLAMA_URL}}' },
                ],
                volumeMounts: [{ name: 'data', mountPath: '/home/node/.openclaw' }],
                resources: {
                  requests: { cpu: '200m', memory: '256Mi' },
                  limits: { cpu: '1000m', memory: '1Gi' },
                },
              }],
              volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'openclaw-data' } }],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'openclaw', namespace: 'default' },
        spec: {
          selector: { app: 'openclaw' },
          ports: [{ port: 18789, targetPort: 18789, nodePort: '{{NODE_PORT}}' }],
          type: 'NodePort',
        },
      },
    ],
  },
];

// List all templates
router.get('/', (req, res) => {
  const list = templates.map(({ id, name, category, description, icon, config }) => ({
    id, name, category, description, icon,
    hasConfig: !!(config && config.length),
  }));
  res.json(list);
});

// Get single template details
router.get('/:id', (req, res) => {
  const template = templates.find((t) => t.id === req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.json(template);
});

// Deploy a template
router.post('/:id/deploy', async (req, res, next) => {
  try {
    const template = templates.find((t) => t.id === req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Build config values from defaults + request body
    const configValues = {};
    if (template.config) {
      for (const item of template.config) {
        configValues[item.id] = req.body.config?.[item.id] ?? item.default;
      }
    }

    // Compute derived values (e.g. container memory = JVM heap + overhead)
    if (configValues.MEMORY) {
      const memoryOverhead = { '512M': '1Gi', '1G': '1536Mi', '2G': '2560Mi' };
      configValues.CONTAINER_MEMORY = memoryOverhead[configValues.MEMORY] || '1536Mi';
    }

    const instanceId = `${template.id}-${Date.now()}`;
    const results = [];
    const resources = [];

    for (const manifest of template.manifests) {
      try {
        // Deep clone and substitute config values
        let processed = substituteConfig(JSON.parse(JSON.stringify(manifest)), configValues);

        // Inject tracking labels
        processed = injectLabels(processed, template.id, instanceId);

        // Convert nodePort string to number if present
        if (processed.spec?.ports) {
          for (const port of processed.spec.ports) {
            if (typeof port.nodePort === 'string') {
              port.nodePort = parseInt(port.nodePort, 10);
            }
          }
        }

        const result = await k8s.applyManifest(processed);
        results.push({
          kind: processed.kind,
          name: processed.metadata.name,
          action: result.action,
        });
        resources.push({
          kind: processed.kind,
          name: processed.metadata.name,
          namespace: processed.metadata.namespace || 'default',
        });
      } catch (err) {
        results.push({
          kind: manifest.kind,
          name: manifest.metadata.name,
          action: 'error',
          error: err.body?.message || err.message,
        });
      }
    }

    // Register app if any resources succeeded
    if (resources.length > 0) {
      appManager.registerApp({
        templateId: template.id,
        templateName: template.name,
        icon: template.icon,
        namespace: template.manifests[0]?.metadata?.namespace || 'default',
        configValues,
        resources,
        instanceId,
      });
    }

    const hasErrors = results.some((r) => r.action === 'error');
    res.status(hasErrors ? 207 : 200).json({
      template: template.id,
      instanceId,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.templates = templates;
module.exports.substituteConfig = substituteConfig;
