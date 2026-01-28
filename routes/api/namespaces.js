const { Router } = require('express');
const k8s = require('../../services/k8s-client');
const config = require('../../config');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const namespaces = await k8s.listNamespaces();
    const result = namespaces.map((ns) => ({
      name: ns.metadata.name,
      status: ns.status.phase,
      createdAt: ns.metadata.creationTimestamp,
      protected: config.protectedNamespaces.includes(ns.metadata.name),
    }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(name)) {
      return res.status(400).json({
        error: 'Invalid namespace name. Must be lowercase alphanumeric with hyphens, 2-63 chars.',
      });
    }
    await k8s.createNamespace(name);
    res.status(201).json({ ok: true, name });
  } catch (err) {
    next(err);
  }
});

router.delete('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    if (config.protectedNamespaces.includes(name)) {
      return res.status(403).json({
        error: `Namespace "${name}" is protected and cannot be deleted from the dashboard`,
      });
    }
    await k8s.deleteNamespace(name);
    res.json({ ok: true, message: `Namespace "${name}" deleted` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
