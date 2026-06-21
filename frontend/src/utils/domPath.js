/**
 * Build a CSS-like DOM path for an element (e.g. div.hero > h1.title).
 */
export function getDomPath(element) {
  const parts = [];
  let current = element;

  while (
    current &&
    current.nodeType === Node.ELEMENT_NODE &&
    current !== current.ownerDocument.documentElement
  ) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (classes.length) {
        selector += `.${classes.join('.')}`;
      }
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Short human-readable label for a picked element.
 */
export function getElementLabel(element) {
  const tag = element.tagName.toLowerCase();

  if (element.id) {
    return `${tag}#${element.id}`;
  }

  if (element.className && typeof element.className === 'string') {
    const firstClass = element.className.trim().split(/\s+/).filter(Boolean)[0];
    if (firstClass) {
      return `${tag}.${firstClass}`;
    }
  }

  return tag;
}
