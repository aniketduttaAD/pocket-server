const express = require('express');
const config = require('../config');
const { runCommand } = require('../lib/shell');
const pm2 = require('../lib/pm2');
const { jsonError } = require('../middleware/validate');

const router = express.Router();

router.get('/presets', (req, res) => {
  res.json({ commands: config.allowlist.commands });
});

router.post('/run', async (req, res) => {
  const { preset, serviceName, cwd, action } = req.body;

  if (action === 'pm2-restart') {
    if (!serviceName || !/^[a-z0-9][a-z0-9-_]{0,62}$/i.test(serviceName)) {
      return jsonError(res, 400, 'Valid serviceName required');
    }
    const result = await pm2.restartService(serviceName);
    return res.json(result);
  }

  if (!preset || !config.allowlist.commands.includes(preset)) {
    return jsonError(res, 403, 'Command not allowed. Use a preset from /api/terminal/presets');
  }

  const parts = preset.split(' ');
  const bin = parts[0];
  const args = parts.slice(1);

  const result = await runCommand(bin, args, {
    cwd: cwd || undefined,
    timeout: 300000,
  });
  res.json(result);
});

module.exports = router;
