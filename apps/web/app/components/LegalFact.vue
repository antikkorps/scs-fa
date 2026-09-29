<script setup lang="ts">
/**
 * One fact from shared/utils/legalIdentity.ts: the value once the client has
 * supplied it, a highlighted placeholder until then (story 12.1).
 */
defineProps<{ value: string | null; label: string }>()
</script>

<template>
  <template v-if="value">{{ value }}</template>
  <mark v-else class="todo">[{{ label }}]</mark>
</template>
