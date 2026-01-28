const { Router } = require('express');
const k8s = require('../../services/k8s-client');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { namespace } = req.query;
    const pods = await k8s.listPods(namespace || undefined);

    const result = pods.map((p) => ({
      name: p.metadata.name,
      namespace: p.metadata.namespace,
      status: p.status.phase,
      nodeName: p.spec.nodeName,
      containers: (p.spec.containers || []).map((c) => c.name),
      restarts: p.status.containerStatuses
        ? p.status.containerStatuses.reduce((sum, c) => sum + c.restartCount, 0)
        : 0,
      ready: p.status.containerStatuses
        ? p.status.containerStatuses.filter((c) => c.ready).length +
          '/' +
          p.status.containerStatuses.length
        : '0/0',
      createdAt: p.metadata.creationTimestamp,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:ns/:name', async (req, res, next) => {
  try {
    const { ns, name } = req.params;
    await k8s.deletePod(ns, name);
    res.json({ ok: true, message: `Pod ${ns}/${name} deleted` });
  } catch (err) {
    next(err);
  }
});

router.get('/:ns/:name/logs', async (req, res, next) => {
  try {
    const { ns, name } = req.params;
    const { container, tailLines } = req.query;
    const logs = await k8s.getPodLogs(
      ns,
      name,
      container || undefined,
      parseInt(tailLines, 10) || 500
    );
    res.type('text/plain').send(logs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
