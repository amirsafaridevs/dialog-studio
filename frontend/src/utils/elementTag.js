const ELEMENT_TAG_PATTERN =
  /<Dialog:element\s+tag="([^"]*)"\s+path="([^"]*)">([^<]*)<\/Dialog:element>/g;

export const ELEMENT_TAG_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z"/><path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/></svg>`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildElementTagHtml({ tag, path, label }, { onLight = false } = {}) {
  const modifier = onLight ? ' chat-element-tag--on-light' : '';

  return `<span class="chat-element-tag${modifier}" title="${escapeHtml(path)}" data-tag="${escapeHtml(tag)}" data-path="${escapeHtml(path)}"><span class="chat-element-tag__icon" aria-hidden="true">${ELEMENT_TAG_ICON_SVG}</span><span class="chat-element-tag__label">${escapeHtml(label)}</span></span>`;
}

export function createElementTagNode(element) {
  const chip = document.createElement('span');
  chip.className = 'chat-element-tag chat-input__inline-tag';
  chip.contentEditable = 'false';
  chip.dataset.tag = element.tagName;
  chip.dataset.path = element.domPath;
  chip.dataset.label = element.label;
  chip.title = element.domPath;

  const meta = {};
  if (element.elementId) meta.id = element.elementId;
  if (element.classes?.length) meta.classes = element.classes;
  if (element.attributes && Object.keys(element.attributes).length) meta.attributes = element.attributes;
  if (element.textContent) meta.textContent = element.textContent;
  if (element.snippet) meta.snippet = element.snippet;
  if (Object.keys(meta).length) {
    chip.dataset.meta = JSON.stringify(meta);
  }

  const icon = document.createElement('span');
  icon.className = 'chat-element-tag__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ELEMENT_TAG_ICON_SVG;

  const label = document.createElement('span');
  label.className = 'chat-element-tag__label';
  label.textContent = element.label;

  chip.append(icon, label);
  return chip;
}

export function renderUserMessage(content) {
  if (!content) {
    return '';
  }

  const parts = [];
  let lastIndex = 0;
  const pattern = new RegExp(ELEMENT_TAG_PATTERN.source, 'g');
  let match = pattern.exec(content);

  while (match) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(content.slice(lastIndex, match.index)));
    }

    parts.push(
      buildElementTagHtml(
        {
          tag: match[1],
          path: match[2],
          label: match[3],
        },
        { onLight: true },
      ),
    );

    lastIndex = pattern.lastIndex;
    match = pattern.exec(content);
  }

  if (lastIndex < content.length) {
    parts.push(escapeHtml(content.slice(lastIndex)));
  }

  return parts.join('');
}
