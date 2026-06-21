/**
 * Dialog Theme Maker — preview iframe bridge.
 * Loaded only when ?dtm_preview=1 is present (see PreviewBridgeService.php).
 */
(function () {
  'use strict';

  if (window.__DTM_PREVIEW_BRIDGE_LOADED__) {
    return;
  }

  window.__DTM_PREVIEW_BRIDGE_LOADED__ = true;

  var CHANNEL = 'dtm-preview-bridge';
  var PICKER_STYLE_ID = 'dtm-element-picker-style';
  var MAX_PARENT_WAIT_ATTEMPTS = 100;
  var PARENT_WAIT_MS = 100;

  if (window.self === window.top) {
    return;
  }

  var origin = window.location.origin;
  var bridgeInitialized = false;
  var pendingSelectMode = false;
  var hovered = null;
  var pickerActive = false;
  var listenersAttached = false;
  var requestCounter = 0;
  var outboundQueue = [];
  var consoleBridgeInstalled = false;

  function getChatWindow() {
    try {
      if (window.top !== window.self && window.top.document.getElementById('dtm-chat-app')) {
        return window.top;
      }
    } catch (error) {
      // Ignore cross-origin access errors.
    }

    return window.parent;
  }

  function postToParent(type, payload) {
    var message = {
      channel: CHANNEL,
      type: type,
      payload: payload || {},
    };

    try {
      getChatWindow().postMessage(message, origin);
    } catch (error) {
      outboundQueue.push(message);
    }
  }

  function flushOutboundQueue() {
    if (!outboundQueue.length) {
      return;
    }

    var target = getChatWindow();
    outboundQueue.forEach(function (message) {
      target.postMessage(message, origin);
    });
    outboundQueue = [];
  }

  function isDialogParent() {
    try {
      if (window.top !== window.self && window.top.document.getElementById('dtm-chat-app')) {
        return true;
      }
      return !!window.parent.document.getElementById('dtm-chat-app');
    } catch (error) {
      return false;
    }
  }

  function waitForDialogParent(callback, attempt) {
    if (isDialogParent()) {
      callback();
      return;
    }

    if ((attempt || 0) >= MAX_PARENT_WAIT_ATTEMPTS) {
      callback();
      return;
    }

    window.setTimeout(function () {
      waitForDialogParent(callback, (attempt || 0) + 1);
    }, PARENT_WAIT_MS);
  }

  function getDomPath(element) {
    var parts = [];
    var current = element;

    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== current.ownerDocument.documentElement
    ) {
      var selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += '#' + current.id;
        parts.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        var classes = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length) {
          selector += '.' + classes.join('.');
        }
      }

      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (child) {
          return child.tagName === current.tagName;
        });
        if (siblings.length > 1) {
          selector += ':nth-of-type(' + (Array.prototype.indexOf.call(siblings, current) + 1) + ')';
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function getElementLabel(element) {
    var tag = element.tagName.toLowerCase();

    if (element.id) {
      return tag + '#' + element.id;
    }

    if (element.className && typeof element.className === 'string') {
      var firstClass = element.className.trim().split(/\s+/).filter(Boolean)[0];
      if (firstClass) {
        return tag + '.' + firstClass;
      }
    }

    return tag;
  }

  function nextRequestId(prefix) {
    requestCounter += 1;
    return prefix + '-' + Date.now() + '-' + requestCounter;
  }

  function respondToParent(requestId, success, result, error) {
    if (!requestId) {
      return;
    }

    postToParent('response', {
      requestId: requestId,
      success: !!success,
      result: result || null,
      error: error || null,
    });
  }

  function queryByDomPath(domPath) {
    if (!domPath || typeof domPath !== 'string') {
      return null;
    }

    var parts = domPath.split('>').map(function (part) {
      return part.trim();
    }).filter(Boolean);

    if (!parts.length) {
      return null;
    }

    var current = document.documentElement;

    for (var index = 0; index < parts.length; index += 1) {
      var part = parts[index];
      var match = part.match(/^([a-z0-9-]+)(?:#([\w-]+))?(?:\.([\w.-]+))?(?::nth-of-type\((\d+)\))?$/i);
      if (!match) {
        return null;
      }

      var tagName = match[1].toLowerCase();
      var id = match[2];
      var classNames = match[3] ? match[3].split('.').filter(Boolean) : [];
      var nth = match[4] ? parseInt(match[4], 10) : null;
      var candidates = Array.prototype.filter.call(current.children, function (child) {
        if (!(child instanceof Element)) {
          return false;
        }
        if (child.tagName.toLowerCase() !== tagName) {
          return false;
        }
        if (id && child.id !== id) {
          return false;
        }
        if (classNames.length) {
          for (var classIndex = 0; classIndex < classNames.length; classIndex += 1) {
            if (!child.classList.contains(classNames[classIndex])) {
              return false;
            }
          }
        }
        return true;
      });

      if (!candidates.length) {
        return null;
      }

      var selected = candidates[0];
      if (nth != null) {
        selected = candidates[nth - 1] || null;
      }

      if (!selected) {
        return null;
      }

      current = selected;
    }

    return current instanceof Element ? current : null;
  }

  function resolveHtmlTarget(payload) {
    var selector = payload && payload.selector ? String(payload.selector).trim() : '';
    var domPath = payload && payload.dom_path ? String(payload.dom_path).trim() : '';

    if (selector) {
      try {
        return document.querySelector(selector);
      } catch (error) {
        return { error: 'Invalid CSS selector: ' + selector };
      }
    }

    if (domPath) {
      var element = queryByDomPath(domPath);
      if (!element) {
        return { error: 'Element not found for dom_path: ' + domPath };
      }
      return element;
    }

    return document.documentElement;
  }

  function serializeHtml(element) {
    if (!element) {
      return '';
    }

    if (element === document.documentElement) {
      return document.documentElement.outerHTML;
    }

    return element.outerHTML;
  }

  function handleNavigateCommand(payload) {
    var requestId = payload && payload.requestId;
    var url = payload && payload.url ? String(payload.url).trim() : '';

    if (!url) {
      respondToParent(requestId, false, null, 'URL is required');
      return;
    }

    try {
      var parsed = new URL(url, window.location.href);
      if (parsed.origin !== origin) {
        respondToParent(requestId, false, null, 'Cross-origin navigation is not allowed');
        return;
      }

      parsed.searchParams.set('dtm_preview', '1');
      announceNavigationStart(parsed.toString());
      window.location.assign(parsed.toString());
      respondToParent(requestId, true, { url: parsed.toString() });
    } catch (error) {
      respondToParent(requestId, false, null, error && error.message ? error.message : 'Navigation failed');
    }
  }

  function handleReloadCommand(payload) {
    var requestId = payload && payload.requestId;
    announceNavigationStart(window.location.href);
    window.location.reload();
    respondToParent(requestId, true, { url: window.location.href });
  }

  var BRIDGE_READY_FALLBACK_MS = 8000;

  function whenPageFullyLoaded(callback) {
    var settled = false;

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      finish();
      return;
    }

    document.addEventListener('DOMContentLoaded', finish, { once: true });
    window.addEventListener('load', finish, { once: true });
    window.setTimeout(finish, BRIDGE_READY_FALLBACK_MS);
  }

  function deliverHtmlResponse(requestId, payload) {
    var target = resolveHtmlTarget(payload || {});

    if (target && target.error) {
      respondToParent(requestId, false, null, target.error);
      return;
    }

    if (!target) {
      respondToParent(requestId, false, null, 'Target element not found');
      return;
    }

    var html = serializeHtml(target);
    var maxChars = 80_000;
    var truncated = false;

    if (html.length > maxChars) {
      html = html.slice(0, maxChars);
      truncated = true;
    }

    respondToParent(requestId, true, {
      html: html,
      truncated: truncated,
      url: window.location.href,
      tagName: target === document.documentElement ? 'html' : target.tagName.toLowerCase(),
      domPath: target === document.documentElement ? 'html' : getDomPath(target),
    });
  }

  function handleGetHtmlCommand(payload) {
    var requestId = payload && payload.requestId;

    whenPageFullyLoaded(function () {
      deliverHtmlResponse(requestId, payload);
    });
  }

  function serializeConsoleArg(arg) {
    if (arg === undefined) {
      return 'undefined';
    }
    if (arg === null) {
      return 'null';
    }
    if (typeof arg === 'string') {
      return arg;
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') {
      return String(arg);
    }
    if (arg instanceof Error) {
      return arg.message + (arg.stack ? '\n' + arg.stack : '');
    }
    if (typeof Element !== 'undefined' && arg instanceof Element) {
      return getElementLabel(arg) + ' <' + getDomPath(arg) + '>';
    }
    if (typeof Node === 'function' && arg instanceof Node) {
      return arg.nodeName ? String(arg.nodeName).toLowerCase() : Object.prototype.toString.call(arg);
    }
    try {
      return JSON.stringify(arg);
    } catch (error) {
      return Object.prototype.toString.call(arg);
    }
  }

  function formatConsoleMessage(args) {
    if (!args || !args.length) {
      return '(empty)';
    }

    return Array.prototype.map.call(args, serializeConsoleArg).join(' ');
  }

  function emitConsole(level, args, stack) {
    var message = formatConsoleMessage(args);

    postToParent('console-entry', {
      id: nextRequestId('log'),
      level: level,
      message: message,
      stack: stack || null,
      timestamp: Date.now(),
      pageUrl: window.location.href,
    });
  }

  function wrapConsoleMethod(level) {
    var original = console[level];
    if (typeof original !== 'function' || original.__dtmWrapped) {
      return;
    }

    var wrapped = function () {
      emitConsole(level, arguments);
      return original.apply(console, arguments);
    };
    wrapped.__dtmWrapped = true;
    console[level] = wrapped;
  }

  function installConsoleBridge() {
    if (consoleBridgeInstalled) {
      return;
    }

    consoleBridgeInstalled = true;

    [
      'log',
      'info',
      'warn',
      'error',
      'debug',
      'trace',
      'table',
      'dir',
      'dirxml',
      'group',
      'groupCollapsed',
      'groupEnd',
      'assert',
      'count',
      'countReset',
      'time',
      'timeLog',
      'timeEnd',
    ].forEach(wrapConsoleMethod);

    if (typeof console === 'object' && console) {
      Object.keys(console).forEach(function (key) {
        wrapConsoleMethod(key);
      });
    }

    window.addEventListener('error', function (event) {
      var message = event.message || 'Script error';
      if (event.filename) {
        message += ' @ ' + event.filename;
        if (event.lineno) {
          message += ':' + event.lineno + ':' + (event.colno || 0);
        }
      }
      emitConsole('error', [message], event.error && event.error.stack ? event.error.stack : null);
    });

    window.addEventListener('unhandledrejection', function (event) {
      var reason = event.reason;
      var message = reason instanceof Error ? reason.message : serializeConsoleArg(reason);
      emitConsole(
        'error',
        ['Unhandled promise rejection: ' + message],
        reason instanceof Error ? reason.stack : null,
      );
    });
  }

  installConsoleBridge();

  function emitNetworkEvent(payload) {
    postToParent('network-entry', payload);
  }

  function installNetworkBridge() {
    if (window.fetch) {
      var originalFetch = window.fetch.bind(window);

      window.fetch = function (input, init) {
        var requestId = nextRequestId('fetch');
        var startedAt = Date.now();
        var method = (init && init.method) || 'GET';
        var url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);

        emitNetworkEvent({
          id: requestId,
          phase: 'start',
          type: 'fetch',
          method: method.toUpperCase(),
          url: url,
          timestamp: startedAt,
        });

        return originalFetch(input, init)
          .then(function (response) {
            emitNetworkEvent({
              id: requestId,
              phase: 'complete',
              type: 'fetch',
              method: method.toUpperCase(),
              url: url,
              status: response.status,
              statusText: response.statusText,
              duration: Date.now() - startedAt,
              timestamp: Date.now(),
            });
            return response;
          })
          .catch(function (error) {
            emitNetworkEvent({
              id: requestId,
              phase: 'error',
              type: 'fetch',
              method: method.toUpperCase(),
              url: url,
              status: 0,
              statusText: error && error.message ? error.message : 'Failed',
              duration: Date.now() - startedAt,
              timestamp: Date.now(),
            });
            throw error;
          });
      };
    }

    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
      var originalOpen = XMLHttpRequest.prototype.open;
      var originalSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url) {
        this.__dtmRequestId = nextRequestId('xhr');
        this.__dtmMethod = method;
        this.__dtmUrl = url;
        this.__dtmStartedAt = Date.now();
        return originalOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        var requestId = xhr.__dtmRequestId;
        var method = (xhr.__dtmMethod || 'GET').toUpperCase();
        var url = xhr.__dtmUrl || '';
        var startedAt = xhr.__dtmStartedAt || Date.now();

        if (requestId) {
          emitNetworkEvent({
            id: requestId,
            phase: 'start',
            type: 'xhr',
            method: method,
            url: url,
            timestamp: startedAt,
          });

          xhr.addEventListener('loadend', function () {
            var failed = xhr.status === 0 && xhr.readyState !== 4;
            emitNetworkEvent({
              id: requestId,
              phase: failed ? 'error' : 'complete',
              type: 'xhr',
              method: method,
              url: url,
              status: xhr.status,
              statusText: xhr.statusText || '',
              duration: Date.now() - startedAt,
              timestamp: Date.now(),
            });
          });
        }

        return originalSend.apply(this, arguments);
      };
    }

    if (window.PerformanceObserver) {
      try {
        var observer = new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (entry) {
            if (entry.entryType !== 'resource') {
              return;
            }

            var initiator = entry.initiatorType || 'resource';

            emitNetworkEvent({
              id: nextRequestId('resource'),
              phase: 'complete',
              type: initiator,
              method: 'GET',
              url: entry.name,
              status: typeof entry.responseStatus === 'number' ? entry.responseStatus : null,
              statusText: '',
              duration: Math.round(entry.duration),
              timestamp: Date.now(),
            });
          });
        });
        observer.observe({ type: 'resource', buffered: true });
      } catch (error) {
        // PerformanceObserver not supported for resource in this browser.
      }
    }
  }

  function clearHover() {
    if (hovered) {
      hovered.classList.remove('dtm-picker-highlight');
      hovered = null;
    }
  }

  function ensurePickerStyles() {
    if (document.getElementById(PICKER_STYLE_ID)) {
      return;
    }

    var style = document.createElement('style');
    style.id = PICKER_STYLE_ID;
    style.textContent =
      '.dtm-picker-highlight {' +
      'outline: 2px solid #2563eb !important;' +
      'outline-offset: 2px !important;' +
      'cursor: crosshair !important;' +
      '}' +
      'body.dtm-picker-active,' +
      'body.dtm-picker-active * {' +
      'cursor: crosshair !important;' +
      '}';
    document.head.appendChild(style);
  }

  function onMouseOver(event) {
    if (!pickerActive) {
      return;
    }

    event.stopPropagation();
    var target = event.target;

    if (
      !(target instanceof Element) ||
      target === document.body ||
      target === document.documentElement
    ) {
      clearHover();
      return;
    }

    if (hovered !== target) {
      clearHover();
      hovered = target;
      hovered.classList.add('dtm-picker-highlight');
    }
  }

  function onMouseOut(event) {
    if (event.target instanceof Element) {
      event.target.classList.remove('dtm-picker-highlight');
    }
    if (hovered === event.target) {
      hovered = null;
    }
  }

  function onClick(event) {
    if (!pickerActive) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    var target = event.target;
    if (
      !(target instanceof Element) ||
      target === document.body ||
      target === document.documentElement
    ) {
      return;
    }

    postToParent('element-picked', {
      tagName: target.tagName.toLowerCase(),
      label: getElementLabel(target),
      domPath: getDomPath(target),
    });
  }

  function attachListeners() {
    if (listenersAttached) {
      return;
    }

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) {
      return;
    }

    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    listenersAttached = false;
  }

  function applySelectMode(active) {
    pickerActive = !!active;

    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function onReady() {
        document.removeEventListener('DOMContentLoaded', onReady);
        applySelectMode(pickerActive);
      });
      return;
    }

    if (pickerActive) {
      ensurePickerStyles();
      document.body.classList.add('dtm-picker-active');
      attachListeners();
      return;
    }

    document.body.classList.remove('dtm-picker-active');
    clearHover();
    detachListeners();
  }

  function announceNavigationStart(url) {
    postToParent('navigation-start', {
      url: url || window.location.href,
      timestamp: Date.now(),
    });
  }

  function announceNavigation() {
    postToParent('navigation', {
      url: window.location.href,
      timestamp: Date.now(),
    });
  }

  function installNavigationBridge() {
    document.addEventListener(
      'click',
      function (event) {
        if (pickerActive) {
          return;
        }

        var target = event.target;
        if (!target || !target.closest) {
          return;
        }

        var link = target.closest('a[href]');
        if (!link) {
          return;
        }

        var href = link.getAttribute('href');
        if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) {
          return;
        }

        try {
          var url = new URL(href, window.location.href);
          if (url.origin !== origin) {
            return;
          }
          if (url.searchParams.get('dtm_preview') !== '1') {
            url.searchParams.set('dtm_preview', '1');
            link.setAttribute('href', url.toString());
          }
          announceNavigationStart(url.toString());
        } catch (error) {
          // Ignore malformed URLs.
        }
      },
      true,
    );

    window.addEventListener('beforeunload', function () {
      announceNavigationStart(window.location.href);
    });

    window.addEventListener('pageshow', announceNavigation);
  }

  function announceBridgeReady() {
    function finish() {
      postToParent('bridge-ready', {
        url: window.location.href,
        readyState: document.readyState,
      });
      announceNavigation();
    }

    whenPageFullyLoaded(finish);
  }

  function initBridge() {
    if (bridgeInitialized) {
      return;
    }

    bridgeInitialized = true;
    installNetworkBridge();
    installNavigationBridge();
    applySelectMode(pendingSelectMode);
    flushOutboundQueue();
    announceBridgeReady();
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== origin) {
      return;
    }

    var data = event.data;
    if (!data || data.channel !== CHANNEL) {
      return;
    }

    if (data.type === 'set-select-mode') {
      pendingSelectMode = !!(data.payload && data.payload.active);
      if (bridgeInitialized) {
        applySelectMode(pendingSelectMode);
      }
    }

    if (data.type === 'navigate') {
      handleNavigateCommand(data.payload || {});
    }

    if (data.type === 'reload') {
      handleReloadCommand(data.payload || {});
    }

    if (data.type === 'get-html') {
      handleGetHtmlCommand(data.payload || {});
    }
  });

  waitForDialogParent(initBridge);
})();
