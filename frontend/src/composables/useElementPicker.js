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
