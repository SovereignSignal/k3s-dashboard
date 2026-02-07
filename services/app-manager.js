const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SAVE_INTERVAL = 30_000;
const DATA_FILE = path.join(__dirname, '..', 'data', 'installed-apps.json');

// In-memory state
let apps = {}; // keyed by instanceId
let saveTimer = null;
let templates = [];
let k8s = null;

function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.apps && typeof data.apps === 'object') {
        apps = data.apps;
        logger.info(`App manager: loaded ${Object.keys(apps).length} apps from disk`);
      }
    }
  } catch (err) {
    logger.warn('App manager: failed to load from disk:', err.message);
  }
}

function saveToDisk() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify({ apps }, null, 2));
  } catch (err) {
    logger.warn('App manager: failed to save to disk:', err.message);
  }
}

function registerApp({ templateId, templateName, icon, namespace, configValues, resources, instanceId }) {
  const id = instanceId || `${templateId}-${Date.now()}`;
  apps[id] = {
    instanceId: id,
    templateId,
    templateName,
    icon: icon || '',
    namespace: namespace || 'default',
    configValues: configValues || {},
    resources: resources || [],
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'deploy',
  };
  saveToDisk();
  logger.info(`App manager: registered app ${id} (${templateName})`);
  return apps[id];
}

function unregisterApp(id) {
  if (apps[id]) {
    const name = apps[id].templateName;
    delete apps[id];
    saveToDisk();
    logger.info(`App manager: unregistered app ${id} (${name})`);
    return true;
  }
  return false;
}

function updateApp(id, updates) {
  if (!apps[id]) return null;
  if (updates.configValues !== undefined) apps[id].configValues = updates.configValues;
  if (updates.resources !== undefined) apps[id].resources = updates.resources;
  apps[id].updatedAt = new Date().toISOString();
  saveToDisk();
  return apps[id];
}

function getApps() {
  return Object.values(apps);
}

function getApp(id) {
  return apps[id] || null;
}

/**
 * Auto-discover existing deployments that match template names.
 * Runs on first startup when no apps are tracked.
 */
async function discoverExistingApps() {
  if (Object.keys(apps).length > 0) return;
  if (!k8s || !templates.length) return;

  logger.info('App manager: discovering existing apps...');

  try {
    const deployments = await k8s.listDeployments();

    for (const template of templates) {
      // Find the deployment name from the template manifests
      const deployManifest = template.manifests.find(m => m.kind === 'Deployment');
      if (!deployManifest) continue;

      const deployName = deployManifest.metadata.name;
      const deployNamespace = deployManifest.metadata.namespace || 'default';

      const match = deployments.find(d =>
        d.metadata.name === deployName &&
        d.metadata.namespace === deployNamespace
      );

      if (match) {
        // Build resources list from template manifests
        const resources = template.manifests.map(m => ({
          kind: m.kind,
          name: m.metadata.name,
          namespace: m.metadata.namespace || 'default',
        }));

        // Try to extract config values from the live deployment's env vars
        const configValues = {};
        if (template.config) {
          const containers = match.spec?.template?.spec?.containers || [];
          const envVars = containers[0]?.env || [];
          for (const cfg of template.config) {
            const envMatch = envVars.find(e => e.name === cfg.id || e.name === cfg.id.toUpperCase());
            if (envMatch) {
              configValues[cfg.id] = envMatch.value;
            }
          }
        }

        const instanceId = `${template.id}-discovered`;
        apps[instanceId] = {
          instanceId,
          templateId: template.id,
          templateName: template.name,
          icon: template.icon || '',
          namespace: deployNamespace,
          configValues,
          resources,
          installedAt: match.metadata.creationTimestamp || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'discovered',
        };

        logger.info(`App manager: discovered ${template.name} in ${deployNamespace}`);
      }
    }

    if (Object.keys(apps).length > 0) {
      saveToDisk();
    }
  } catch (err) {
    logger.warn('App manager: discovery failed:', err.message);
  }
}

function start(templateList, k8sClient) {
  templates = templateList || [];
  k8s = k8sClient;

  logger.info('Starting app manager');
  loadFromDisk();

  // Run discovery async
  discoverExistingApps();

  saveTimer = setInterval(saveToDisk, SAVE_INTERVAL);
}

function stop() {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  saveToDisk();
  logger.info('Stopped app manager');
}

module.exports = {
  start,
  stop,
  registerApp,
  unregisterApp,
  updateApp,
  getApps,
  getApp,
};
