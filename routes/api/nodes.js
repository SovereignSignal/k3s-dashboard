const { Router } = require('express');
const k8s = require('../../services/k8s-client');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [nodes, metrics] = await Promise.all([
      k8s.listNodes(),
      k8s.getNodeMetrics(),
    ]);

    const result = nodes.map((n) => {
      const conditions = n.status.conditions || [];
      const ready = conditions.find((c) => c.type === 'Ready');
      const metric = metrics.items?.find((m) => m.metadata.name === n.metadata.name);

      return {
        name: n.metadata.name,
        ready: ready?.status === 'True',
        roles: Object.keys(n.metadata.labels || {})
          .filter((l) => l.startsWith('node-role.kubernetes.io/'))
          .map((l) => l.split('/')[1]),
        cpu: {
          used: metric ? k8s.parseCpu(metric.usage?.cpu) : 0,
          total: k8s.parseCpu(n.status.capacity?.cpu),
        },
        memory: {
          used: metric ? k8s.parseMem(metric.usage?.memory) : 0,
          total: k8s.parseMem(n.status.capacity?.memory),
        },
        kubeletVersion: n.status.nodeInfo?.kubeletVersion,
        os: n.status.nodeInfo?.osImage,
        arch: n.status.nodeInfo?.architecture,
        addresses: n.status.addresses,
        conditions: conditions.map((c) => ({
          type: c.type,
          status: c.status,
          message: c.message,
        })),
        createdAt: n.metadata.creationTimestamp,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:name', async (req, res, next) => {
  try {
    const { node, metrics } = await k8s.getNodeWithMetrics(req.params.name);
    const pods = await k8s.listPods();
    const nodePods = pods.filter((p) => p.spec.nodeName === req.params.name);

    res.json({
      node: {
        name: node.metadata.name,
        labels: node.metadata.labels,
        annotations: node.metadata.annotations,
        conditions: node.status.conditions,
        capacity: node.status.capacity,
        allocatable: node.status.allocatable,
        nodeInfo: node.status.nodeInfo,
        addresses: node.status.addresses,
        createdAt: node.metadata.creationTimestamp,
      },
      metrics: metrics
        ? {
            cpu: metrics.usage?.cpu,
            memory: metrics.usage?.memory,
          }
        : null,
      pods: nodePods.map((p) => ({
        name: p.metadata.name,
        namespace: p.metadata.namespace,
        status: p.status.phase,
        restarts: p.status.containerStatuses
          ? p.status.containerStatuses.reduce((sum, c) => sum + c.restartCount, 0)
          : 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
