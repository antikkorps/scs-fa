<script setup lang="ts">
import { formatCountdown, formatTime } from "~/utils/format"

// Story 12.9a — a unique piece or a Gun Art print is held for the shopper for a
// while (CGV), then goes back on sale. The countdown is for sighted shoppers; a
// screen reader gets the end time once instead of a number changing every second.
const props = defineProps<{ heldUntil: string }>()
const emit = defineEmits<{ expired: [] }>()

const SHORT_MS = 5 * 60 * 1000

const now = ref(Date.now())
const remainingMs = computed(() => Math.max(0, Date.parse(props.heldUntil) - now.value))

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
    if (remainingMs.value > 0) return
    clearInterval(timer)
    emit("expired")
  }, 1000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <p class="hold" :class="{ 'hold--short': remainingMs < SHORT_MS }">
    <span aria-hidden="true">Réservé pour vous encore {{ formatCountdown(remainingMs) }}</span>
    <span class="sr-only">Réservé pour vous jusqu'à {{ formatTime(heldUntil) }}</span>
  </p>
</template>

<style scoped>
.hold {
  margin: 0.25rem 0 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  font-variant-numeric: tabular-nums;
}
.hold--short {
  color: var(--brass);
}
</style>
