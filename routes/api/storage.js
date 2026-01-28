const { Router } = require('express');
const k8s = require('@kubernetes/client-node');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const config = require('../../config');

const kc = new k8s.KubeConfig();
if (config.kubeconfigPath) {
  kc.loadFromFile(config.kubeconfigPath);
} else {
  kc.loadFromDefault();
}

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const storageApi = kc.makeApiClient(k8s.StorageV1Api);

const router = Router();

// Get storage classes
router.get('/classes', async (req, res, next) => {
  try {
    const result = await storageApi.listStorageClass();
    const classes = result.items.map((sc) => ({
      name: sc.metadata.name,
      provisioner: sc.provisioner,
      reclaimPolicy: sc.reclaimPolicy,
      volumeBindingMode: sc.volumeBindingMode,
      allowVolumeExpansion: sc.allowVolumeExpansion || false,
      isDefault: sc.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
      parameters: sc.parameters || {},
      createdAt: sc.metadata.creationTimestamp,
    }));
    res.json(classes);
  } catch (err) {
    next(err);
  }
});

// Get persistent volumes
router.get('/pv', async (req, res, next) => {
  try {
    const result = await coreApi.listPersistentVolume();
    const pvs = result.items.map((pv) => ({
      name: pv.metadata.name,
      capacity: pv.spec.capacity?.storage,
      accessModes: pv.spec.accessModes,
      reclaimPolicy: pv.spec.persistentVolumeReclaimPolicy,
      status: pv.status.phase,
      claim: pv.spec.claimRef
        ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}`
        : null,
      storageClass: pv.spec.storageClassName,
      node: pv.spec.nodeAffinity?.required?.nodeSelectorTerms?.[0]?.matchExpressions?.[0]?.values?.[0] || '',
      path: pv.spec.local?.path || pv.spec.hostPath?.path || '',
      createdAt: pv.metadata.creationTimestamp,
    }));
    res.json(pvs);
  } catch (err) {
    next(err);
  }
});

// Get persistent volume claims
router.get('/pvc', async (req, res, next) => {
  try {
    const { namespace } = req.query;
    let result;
    if (namespace) {
      result = await coreApi.listNamespacedPersistentVolumeClaim({ namespace });
    } else {
      result = await coreApi.listPersistentVolumeClaimForAllNamespaces();
    }
    const pvcs = result.items.map((pvc) => ({
      name: pvc.metadata.name,
      namespace: pvc.metadata.namespace,
      status: pvc.status.phase,
      volume: pvc.spec.volumeName,
      capacity: pvc.status.capacity?.storage || pvc.spec.resources?.requests?.storage,
      accessModes: pvc.spec.accessModes,
      storageClass: pvc.spec.storageClassName,
      createdAt: pvc.metadata.creationTimestamp,
    }));
    res.json(pvcs);
  } catch (err) {
    next(err);
  }
});

// Get node storage info (requires SSH access to nodes)
router.get('/nodes', async (req, res, next) => {
  try {
    // Get nodes from k8s
    const nodesResult = await coreApi.listNode();
    const nodeStorage = [];

    for (const node of nodesResult.items) {
      const nodeName = node.metadata.name;
      const ephemeralStorage = node.status.capacity?.['ephemeral-storage'];

      // Parse ephemeral storage to GB
      let ephemeralGB = 0;
      if (ephemeralStorage) {
        if (ephemeralStorage.endsWith('Ki')) {
          ephemeralGB = parseInt(ephemeralStorage) / (1024 * 1024);
        } else if (ephemeralStorage.endsWith('Mi')) {
          ephemeralGB = parseInt(ephemeralStorage) / 1024;
        } else if (ephemeralStorage.endsWith('Gi')) {
          ephemeralGB = parseFloat(ephemeralStorage);
        }
      }

      const info = {
        name: nodeName,
        ephemeralStorage: ephemeralGB.toFixed(1) + ' GB',
        devices: [],
      };

      // Try to get block device info via SSH (or locally if this is the current node)
      try {
        const hostname = require('os').hostname();
        const cmd = nodeName === hostname
          ? 'lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,MODEL,FSTYPE'
          : `ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${nodeName} "lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,MODEL,FSTYPE" 2>/dev/null`;
        const { stdout } = await execAsync(cmd, { timeout: 5000 });
        const lsblk = JSON.parse(stdout);

        for (const device of lsblk.blockdevices || []) {
          if (device.type === 'disk' && !device.name.startsWith('loop') && !device.name.startsWith('zram')) {
            const isSSD = device.model?.toLowerCase().includes('ssd') ||
                          device.name.startsWith('sd') ||
                          device.name.startsWith('nvme');
            const isSD = device.name.startsWith('mmcblk');

            // Find mount points from children
            let mountPoints = [];
            if (device.children) {
              for (const child of device.children) {
                if (child.mountpoint) {
                  mountPoints.push({
                    partition: child.name,
                    mountpoint: child.mountpoint,
                    size: child.size,
                    fstype: child.fstype,
                  });
                }
              }
            } else if (device.mountpoint) {
              mountPoints.push({
                partition: device.name,
                mountpoint: device.mountpoint,
                size: device.size,
                fstype: device.fstype,
              });
            }

            info.devices.push({
              name: device.name,
              size: device.size,
              type: isSSD ? 'SSD' : (isSD ? 'SD Card' : 'Unknown'),
              model: device.model || (isSD ? 'SD Card' : 'Unknown'),
              mountPoints,
            });
          }
        }
      } catch (sshErr) {
        // SSH failed, just use k8s info
        info.sshError = 'Could not retrieve block device info';
      }

      nodeStorage.push(info);
    }

    res.json(nodeStorage);
  } catch (err) {
    next(err);
  }
});

// Create storage class
router.post('/classes', async (req, res, next) => {
  try {
    const { name, provisioner, reclaimPolicy, volumeBindingMode, parameters } = req.body;

    if (!name || !provisioner) {
      return res.status(400).json({ error: 'name and provisioner are required' });
    }

    const body = {
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name },
      provisioner,
      reclaimPolicy: reclaimPolicy || 'Delete',
      volumeBindingMode: volumeBindingMode || 'WaitForFirstConsumer',
      parameters: parameters || {},
    };

    await storageApi.createStorageClass({ body });
    res.status(201).json({ ok: true, name });
  } catch (err) {
    next(err);
  }
});

// Delete storage class
router.delete('/classes/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    if (name === 'local-path') {
      return res.status(403).json({ error: 'Cannot delete default storage class' });
    }
    await storageApi.deleteStorageClass({ name });
    res.json({ ok: true, message: `StorageClass "${name}" deleted` });
  } catch (err) {
    next(err);
  }
});

// Delete PVC
router.delete('/pvc/:namespace/:name', async (req, res, next) => {
  try {
    const { namespace, name } = req.params;
    await coreApi.deleteNamespacedPersistentVolumeClaim({ name, namespace });
    res.json({ ok: true, message: `PVC ${namespace}/${name} deleted` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
