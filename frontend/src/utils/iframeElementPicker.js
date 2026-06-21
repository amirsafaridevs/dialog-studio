const PICKER_STYLE_ID = 'dtm-element-picker-style';

/**
 * Attach hover/click handlers inside an iframe document for element picking.
 * Returns a cleanup function.
 */
export function setupIframeElementPicker(doc, onPick) {
  if (!doc?.body) {
    return () => {};
  }

  const style = doc.createElement('style');
  style.id = PICKER_STYLE_ID;
  style.textContent = `
    .dtm-picker-highlight {
      outline: 2px solid #2563eb !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    body.dtm-picker-active,
    body.dtm-picker-active * {
      cursor: crosshair !important;
    }
  `;
  doc.head.appendChild(style);
  doc.body.classList.add('dtm-picker-active');

  let hovered = null;

  function clearHover() {
    if (hovered) {
      hovered.classList.remove('dtm-picker-highlight');
      hovered = null;
    }
  }

  function onMouseOver(event) {
    event.stopPropagation();
    const target = event.target;

    if (!(target instanceof Element) || target === doc.body || target === doc.documentElement) {
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
    event.preventDefault();
    event.stopPropagation();

    const target = event.target;
    if (!(target instanceof Element) || target === doc.body || target === doc.documentElement) {
      return;
    }

    onPick(target);
  }

  doc.addEventListener('mouseover', onMouseOver, true);
  doc.addEventListener('mouseout', onMouseOut, true);
  doc.addEventListener('click', onClick, true);

  return () => {
    doc.removeEventListener('mouseover', onMouseOver, true);
    doc.removeEventListener('mouseout', onMouseOut, true);
    doc.removeEventListener('click', onClick, true);
    doc.body?.classList.remove('dtm-picker-active');
    doc.getElementById(PICKER_STYLE_ID)?.remove();
    clearHover();
  };
}
