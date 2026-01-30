const { Router } = require('express');
const k8s = require('../../services/k8s-client');

const router = Router();

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
    name: 'Ollama + Qwen2.5 1.5B',
    category: 'AI',
    description: 'Qwen2.5 1.5B - Best quality for size (~2GB RAM)',
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
                  { name: 'OLLAMA_MODEL', value: 'qwen2.5:1.5b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull qwen2.5:1.5b &'],
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
    name: 'Ollama + Phi-3 Mini',
    category: 'AI',
    description: 'Phi-3 Mini 3.8B - Strong reasoning (~2.5GB RAM)',
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
                  { name: 'OLLAMA_MODEL', value: 'phi3:mini' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull phi3:mini &'],
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
    name: 'Ollama + Gemma 2B',
    category: 'AI',
    description: 'Google Gemma 2B - Great for conversation (~1.5GB RAM)',
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
                  requests: { cpu: '500m', memory: '1536Mi' },
                  limits: { cpu: '4', memory: '2560Mi' },
                },
                env: [
                  { name: 'OLLAMA_HOST', value: '0.0.0.0' },
                  { name: 'OLLAMA_MODEL', value: 'gemma:2b' },
                ],
                lifecycle: {
                  postStart: {
                    exec: {
                      command: ['/bin/sh', '-c', 'sleep 5 && ollama pull gemma:2b &'],
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
];

// List all templates
router.get('/', (req, res) => {
  const list = templates.map(({ id, name, category, description, icon }) => ({
    id, name, category, description, icon,
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

    const results = [];
    for (const manifest of template.manifests) {
      try {
        const result = await k8s.applyManifest(manifest);
        results.push({
          kind: manifest.kind,
          name: manifest.metadata.name,
          action: result.action,
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

    const hasErrors = results.some((r) => r.action === 'error');
    res.status(hasErrors ? 207 : 200).json({
      template: template.id,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
