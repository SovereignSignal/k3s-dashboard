const { Router } = require('express');
const yaml = require('js-yaml');
const k8s = require('../../services/k8s-client');
const logger = require('../../utils/logger');

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { manifest } = req.body;
    if (!manifest) {
      return res.status(400).json({ error: 'manifest is required' });
    }

    // Parse YAML - supports multi-document
    let docs;
    try {
      docs = yaml.loadAll(manifest).filter(Boolean);
    } catch (parseErr) {
      return res.status(400).json({ error: `YAML parse error: ${parseErr.message}` });
    }

    if (docs.length === 0) {
      return res.status(400).json({ error: 'No valid documents found in YAML' });
    }

    // Validate each document has required fields
    for (const doc of docs) {
      if (!doc.apiVersion || !doc.kind || !doc.metadata?.name) {
        return res.status(400).json({
          error: 'Each document must have apiVersion, kind, and metadata.name',
        });
      }
    }

    const results = [];
    for (const doc of docs) {
      try {
        const result = await k8s.applyManifest(doc);
        results.push({
          kind: doc.kind,
          name: doc.metadata.name,
          namespace: doc.metadata.namespace || '',
          action: result.action,
        });
      } catch (applyErr) {
        logger.error('Apply failed for', doc.kind, doc.metadata.name, applyErr.message);
        results.push({
          kind: doc.kind,
          name: doc.metadata.name,
          namespace: doc.metadata.namespace || '',
          action: 'error',
          error: applyErr.body?.message || applyErr.message,
        });
      }
    }

    const hasErrors = results.some((r) => r.action === 'error');
    res.status(hasErrors ? 207 : 200).json({ results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
