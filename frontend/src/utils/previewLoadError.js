export class PreviewLoadError extends Error {
  constructor(message, diagnostics = {}) {
    super(message);
    this.name = 'PreviewLoadError';
    this.diagnostics = diagnostics;
  }
}

export function isPreviewLoadError(error) {
  return error instanceof PreviewLoadError || error?.name === 'PreviewLoadError';
}
