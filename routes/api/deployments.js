const { Router } = require('express');
const k8s = require('../../services/k8s-client');
const config = require('../../config');

const router = Router();

function isProtectedDeployment(name) {
  return config.protectedDeploymentPrefixes.some((prefix) =>
    name.startsWith(prefix)
  );
}

router.get('/', async (req, res, next) => {
  try {
    const { namespace } = req.query;
    const deployments = await k8s.listDeployments(namespace || undefined);

    const result = deployments.map((d) => ({
      name: d.metadata.name,
      namespace: d.metadata.namespace,
      replicas: d.spec.replicas || 0,
      readyReplicas: d.status.readyReplicas || 0,
      availableReplicas: d.status.availableReplicas || 0,
      updatedReplicas: d.status.updatedReplicas || 0,
      images: (d.spec.template.spec.containers || []).map((c) => c.image),
      createdAt: d.metadata.creationTimestamp,
      protected: isProtectedDeployment(d.metadata.name),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { namespace, body } = req.body;
    if (!namespace || !body) {
      return res.status(400).json({ error: 'namespace and body required' });
    }
    const result = await k8s.createDeployment(namespace, body);
    res.status(201).json({ ok: true, name: result.metadata.name });
  } catch (err) {
    next(err);
  }
});

router.delete('/:ns/:name', async (req, res, next) => {
  try {
    const { ns, name } = req.params;
    if (isProtectedDeployment(name)) {
      return res.status(403).json({ error: `Deployment "${name}" is protected and cannot be deleted from the dashboard` });
    }
    await k8s.deleteDeployment(ns, name);
    res.json({ ok: true, message: `Deployment ${ns}/${name} deleted` });
  } catch (err) {
    next(err);
  }
});

router.post('/:ns/:name/scale', async (req, res, next) => {
  try {
    const { ns, name } = req.params;
    const { replicas } = req.body;
    if (replicas == null || replicas < 0) {
      return res.status(400).json({ error: 'Valid replicas count required' });
    }
    await k8s.scaleDeployment(ns, name, parseInt(replicas, 10));
    res.json({ ok: true, message: `Deployment ${ns}/${name} scaled to ${replicas}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
