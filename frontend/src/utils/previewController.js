/**
 * Singleton registry for the preview iframe controller.
 * BrowserPanel registers itself on mount; agent tools call through here.
 */

let controller = null;

export function registerPreviewController(impl) {
  controller = impl;
}

export function unregisterPreviewController() {
  controller = null;
}

export function getPreviewController() {
  return controller;
}

export function isPreviewControllerReady() {
  return Boolean(controller);
}
