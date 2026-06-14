<script setup lang="ts">
import type { Severity } from "~/utils/status"

defineProps<{ label: string; severity: Severity }>()
</script>

<template>
  <span class="tag" :class="`tag--${severity}`">{{ label }}</span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--ink-line);
  white-space: nowrap;
}
.tag--ok {
  color: var(--brass);
  border-color: rgba(200, 163, 91, 0.4);
  background: rgba(200, 163, 91, 0.08);
}
.tag--warn {
  color: #e0b15f;
  border-color: rgba(224, 177, 95, 0.35);
  background: rgba(224, 177, 95, 0.07);
}
.tag--bad {
  color: var(--danger);
  border-color: rgba(217, 138, 106, 0.4);
  background: rgba(217, 138, 106, 0.08);
}
.tag--muted {
  color: var(--paper-faint);
  background: rgba(255, 255, 255, 0.02);
}
</style>
