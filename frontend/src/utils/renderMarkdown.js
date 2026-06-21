import { marked } from 'marked';

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

export function renderMarkdown(content) {
  if (!content) {
    return '';
  }

  try {
    return marked.parse(String(content), { async: false });
  } catch {
    return `<p>${escapeHtml(String(content))}</p>`;
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
