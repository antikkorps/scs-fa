<script setup lang="ts">
import { LEGAL_IDENTITY, type TermsInline } from "@armurier/shared"

/**
 * Renders a run of CGV text (packages/shared/src/terms-content.ts) on the
 * site — the same data the order confirmation e-mail renders (story 12.1).
 */
defineProps<{ content: TermsInline[] }>()
</script>

<template>
  <template v-for="(item, i) in content" :key="i">
    <template v-if="typeof item === 'string'">{{ item }}</template>
    <strong v-else-if="'strong' in item">{{ item.strong }}</strong>
    <NuxtLink v-else-if="'link' in item" :to="item.path">{{ item.link }}</NuxtLink>
    <LegalFact v-else-if="'fact' in item" :value="LEGAL_IDENTITY[item.fact]" :label="item.label" />
    <mark v-else class="todo">[{{ item.todo }}]</mark>
  </template>
</template>
