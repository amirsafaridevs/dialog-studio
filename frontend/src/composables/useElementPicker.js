import { ref } from 'vue';

const isSelectMode = ref(false);
const pickVersion = ref(0);
const lastPick = ref(null);

export function useElementPicker() {
  function toggleSelectMode() {
    isSelectMode.value = !isSelectMode.value;
  }

  function addPickedElement(element) {
    lastPick.value = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tagName: element.tagName,
      label: element.label,
      domPath: element.domPath,
      elementId: element.id || null,
      classes: element.classes || [],
      attributes: element.attributes || {},
      textContent: element.textContent || null,
      snippet: element.snippet || null,
    };
    pickVersion.value += 1;
  }

  return {
    isSelectMode,
    pickVersion,
    lastPick,
    toggleSelectMode,
    addPickedElement,
  };
}
