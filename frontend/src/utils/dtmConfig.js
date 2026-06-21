export function getDtmConfig() {
  return window.__DTM_CONFIG__ || {
    apiBase: '/DialogStudio/v1',
    settingsNonce: '',
    theme: {
      workspacePath: 'wp-content/dialog',
      ready: true,
      installed: true,
      message: '',
    },
  };
}

export default getDtmConfig;
