module.exports = {
  apps: [{
    name: 'cloud-agent',
    script: './cloud-agent.js',
    cwd: '/www/dk_project/fhcode-deploy/cloud-agent',
    interpreter: 'node',
    env: {
      FH_BRIDGE_URL: 'http://127.0.0.1:18080',
      FH_BRIDGE_TOKEN: require('fs').readFileSync('/www/dk_project/fhcode-deploy/.fh_token', 'utf8').trim(),
      FH_CLOUD_DEVICE_ID: 'pc-cloud-agent-01',
      FH_CLOUD_NAME: '云端执行体',
      FH_CLOUD_WORKDIR: '/www/dk_project/fhcode-cloud-work'
    }
  }]
};
