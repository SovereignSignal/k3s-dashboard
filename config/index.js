const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), debug: false });

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  bindAddress: process.env.BIND_ADDRESS || '192.168.50.22',
  sessionSecret: process.env.SESSION_SECRET,
  passwordHash: process.env.PASSWORD_HASH,
  sessionTTLHours: parseInt(process.env.SESSION_TTL_HOURS, 10) || 8,
  kubeconfigPath: process.env.KUBECONFIG_PATH || '',
  metricsCacheTTL: 10_000, // 10 seconds
  protectedNamespaces: ['kube-system', 'kube-public', 'kube-node-lease'],
  protectedDeploymentPrefixes: ['coredns', 'local-path-provisioner', 'metrics-server', 'traefik'],
};
