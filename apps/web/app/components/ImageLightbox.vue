<script setup lang="ts">
// Accessible, dependency-free full-size image overlay. Controlled with v-model:
//   <ImageLightbox v-model="open" :src="url" :alt="title" />
// Closes on Escape, on backdrop click, and on the close button; locks body
// scroll and moves focus to the close button while open.
const open = defineModel<boolean>({ default: false })
defineProps<{ src: string; alt: string }>()

const closeBtn = ref<HTMLButtonElement | null>(null)

function close() {
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close()
}

watch(open, async (isOpen) => {
  if (!import.meta.client) return
  if (isOpen) {
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeydown)
    await nextTick()
    closeBtn.value?.focus()
  } else {
    document.body.style.overflow = ""
    window.removeEventListener("keydown", onKeydown)
  }
})

onBeforeUnmount(() => {
  if (!import.meta.client) return
  document.body.style.overflow = ""
  window.removeEventListener("keydown", onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="lb">
      <div v-if="open" class="lb" role="dialog" aria-modal="true" :aria-label="alt" @click.self="close">
        <button ref="closeBtn" type="button" class="lb__close" aria-label="Fermer" @click="close">
          <span aria-hidden="true">✕</span>
        </button>
        <img class="lb__img" :src="src" :alt="alt" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lb {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: clamp(1rem, 4vw, 3rem);
  background: rgba(8, 8, 10, 0.92);
  backdrop-filter: blur(6px);
}
.lb__img {
  max-width: 92vw;
  max-height: 92vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.lb__close {
  position: absolute;
  top: clamp(0.75rem, 3vw, 1.5rem);
  right: clamp(0.75rem, 3vw, 1.5rem);
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
  color: var(--paper);
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  cursor: pointer;
  transition:
    color 0.3s var(--ease),
    border-color 0.3s var(--ease);
}
.lb__close:hover {
  color: var(--brass);
  border-color: var(--brass);
}

.lb-enter-active,
.lb-leave-active {
  transition: opacity 0.25s var(--ease);
}
.lb-enter-from,
.lb-leave-to {
  opacity: 0;
}
</style>
