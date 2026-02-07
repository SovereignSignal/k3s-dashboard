const { Router } = require('express');
const k8s = require('../../services/k8s-client');
const appManager = require('../../services/app-manager');
const { templates, substituteConfig } = require('./templates');

const router = Router();

// GET /api/apps — List all installed apps with live status
router.get('/', async (req, res, next) => {
  try {
    const apps = appManager.getApps();
    const [deployments, pods] = await Promise.all([
      k8s.listDeployments(),
      k8s.listPods(),
    ]);

    const enriched = apps.map(app => {
      // Find the deployment resource
      const deployRes = app.resources.find(r => r.kind === 'Deployment');
      let status = 'unknown';
      let replicas = { desired: 0, ready: 0, available: 0 };
      let podList = [];

      if (deployRes) {
        const dep = deployments.find(d =>
          d.metadata.name === deployRes.name &&
          d.metadata.namespace === deployRes.namespace
        );

        if (dep) {
          replicas = {
            desired: dep.spec?.replicas || 0,
            ready: dep.status?.readyReplicas || 0,
            available: dep.status?.availableReplicas || 0,
          };

          // Get pods matching this deployment's selector
          const selector = dep.spec?.selector?.matchLabels || {};
          podList = pods.filter(p => {
            if (p.metadata.namespace !== deployRes.namespace) return false;
            const podLabels = p.metadata.labels || {};
            return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
          }).map(p => ({
            name: p.metadata.name,
            phase: p.status?.phase || 'Unknown',
            ready: p.status?.containerStatuses?.every(c => c.ready) || false,
            restarts: (p.status?.containerStatuses || []).reduce((sum, c) => sum + (c.restartCount || 0), 0),
            startTime: p.status?.startTime,
          }));

          if (replicas.ready > 0 && replicas.ready >= replicas.desired) {
            status = 'running';
          } else if (replicas.ready > 0) {
            status = 'degraded';
          } else if (dep.spec?.replicas === 0) {
            status = 'stopped';
          } else {
            status = 'error';
          }
        } else {
          status = 'not_found';
        }
      }

      // Check if template has config
      const template = templates.find(t => t.id === app.templateId);
      const hasConfig = !!(template?.config && template.config.length);

      return {
        ...app,
        status,
        replicas,
        pods: podList,
        hasConfig,
      };
    });

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// GET /api/apps/:id — Single app detail
router.get('/:id', async (req, res, next) => {
  try {
    const app = appManager.getApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const [deployments, pods] = await Promise.all([
      k8s.listDeployments(),
      k8s.listPods(),
    ]);

    const deployRes = app.resources.find(r => r.kind === 'Deployment');
    let status = 'unknown';
    let replicas = { desired: 0, ready: 0, available: 0 };
    let podList = [];

    if (deployRes) {
      const dep = deployments.find(d =>
        d.metadata.name === deployRes.name &&
        d.metadata.namespace === deployRes.namespace
      );

      if (dep) {
        replicas = {
          desired: dep.spec?.replicas || 0,
          ready: dep.status?.readyReplicas || 0,
          available: dep.status?.availableReplicas || 0,
        };

        const selector = dep.spec?.selector?.matchLabels || {};
        podList = pods.filter(p => {
          if (p.metadata.namespace !== deployRes.namespace) return false;
          const podLabels = p.metadata.labels || {};
          return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
        }).map(p => ({
          name: p.metadata.name,
          phase: p.status?.phase || 'Unknown',
          ready: p.status?.containerStatuses?.every(c => c.ready) || false,
          restarts: (p.status?.containerStatuses || []).reduce((sum, c) => sum + (c.restartCount || 0), 0),
          startTime: p.status?.startTime,
          node: p.spec?.nodeName,
        }));

        if (replicas.ready > 0 && replicas.ready >= replicas.desired) {
          status = 'running';
        } else if (replicas.ready > 0) {
          status = 'degraded';
        } else if (dep.spec?.replicas === 0) {
          status = 'stopped';
        } else {
          status = 'error';
        }
      } else {
        status = 'not_found';
      }
    }

    const template = templates.find(t => t.id === app.templateId);
    const hasConfig = !!(template?.config && template.config.length);

    res.json({
      ...app,
      status,
      replicas,
      pods: podList,
      hasConfig,
      templateConfig: template?.config || [],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/apps/:id/restart — Restart app by deleting its pods
router.post('/:id/restart', async (req, res, next) => {
  try {
    const app = appManager.getApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const deployRes = app.resources.find(r => r.kind === 'Deployment');
    if (!deployRes) return res.status(400).json({ error: 'No deployment found for this app' });

    // Get pods matching the deployment
    const allPods = await k8s.listPods(deployRes.namespace);
    const deployments = await k8s.listDeployments(deployRes.namespace);
    const dep = deployments.find(d => d.metadata.name === deployRes.name);

    if (!dep) return res.status(404).json({ error: 'Deployment not found in cluster' });

    const selector = dep.spec?.selector?.matchLabels || {};
    const matchingPods = allPods.filter(p => {
      const podLabels = p.metadata.labels || {};
      return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
    });

    const deleted = [];
    for (const pod of matchingPods) {
      try {
        await k8s.deletePod(pod.metadata.namespace, pod.metadata.name);
        deleted.push(pod.metadata.name);
      } catch (err) {
        // Ignore errors for individual pods
      }
    }

    res.json({ restarted: true, podsDeleted: deleted.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/apps/:id/scale — Scale the app's deployment
router.post('/:id/scale', async (req, res, next) => {
  try {
    const app = appManager.getApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const { replicas } = req.body;
    if (replicas === undefined || replicas < 0) {
      return res.status(400).json({ error: 'Invalid replicas value' });
    }

    const deployRes = app.resources.find(r => r.kind === 'Deployment');
    if (!deployRes) return res.status(400).json({ error: 'No deployment found for this app' });

    await k8s.scaleDeployment(deployRes.namespace, deployRes.name, replicas);
    res.json({ scaled: true, replicas });
  } catch (err) {
    next(err);
  }
});

// POST /api/apps/:id/reconfigure — Re-deploy with new config
router.post('/:id/reconfigure', async (req, res, next) => {
  try {
    const app = appManager.getApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const template = templates.find(t => t.id === app.templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (!template.config || !template.config.length) {
      return res.status(400).json({ error: 'Template has no configurable options' });
    }

    // Build new config values from defaults + request body
    const configValues = {};
    for (const item of template.config) {
      configValues[item.id] = req.body.config?.[item.id] ?? app.configValues[item.id] ?? item.default;
    }

    // Compute derived values
    if (configValues.MEMORY) {
      const memoryOverhead = { '512M': '1Gi', '1G': '1536Mi', '2G': '2560Mi' };
      configValues.CONTAINER_MEMORY = memoryOverhead[configValues.MEMORY] || '1536Mi';
    }

    const results = [];
    for (const manifest of template.manifests) {
      try {
        let processed = substituteConfig(JSON.parse(JSON.stringify(manifest)), configValues);

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
      } catch (err) {
        results.push({
          kind: manifest.kind,
          name: manifest.metadata.name,
          action: 'error',
          error: err.body?.message || err.message,
        });
      }
    }

    // Update stored config
    appManager.updateApp(req.params.id, { configValues });

    res.json({ reconfigured: true, results });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/apps/:id — Uninstall app
router.delete('/:id', async (req, res, next) => {
  try {
    const app = appManager.getApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const deletePVC = req.query.deletePVC === 'true';
    const results = [];

    // Delete resources in reverse order (Service first, then Deployment, then PVC/ConfigMap)
    const ordered = [...app.resources].sort((a, b) => {
      const order = { Service: 0, Deployment: 1, ConfigMap: 2, PersistentVolumeClaim: 3 };
      return (order[a.kind] ?? 99) - (order[b.kind] ?? 99);
    });

    for (const resource of ordered) {
      // Skip PVCs unless explicitly requested
      if (resource.kind === 'PersistentVolumeClaim' && !deletePVC) {
        results.push({ kind: resource.kind, name: resource.name, action: 'skipped' });
        continue;
      }

      try {
        await k8s.deleteResource(resource.kind, resource.namespace, resource.name);
        results.push({ kind: resource.kind, name: resource.name, action: 'deleted' });
      } catch (err) {
        const code = err.code || err.statusCode;
        if (code === 404) {
          results.push({ kind: resource.kind, name: resource.name, action: 'not_found' });
        } else {
          results.push({ kind: resource.kind, name: resource.name, action: 'error', error: err.message });
        }
      }
    }

    appManager.unregisterApp(req.params.id);
    res.json({ uninstalled: true, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
