<script setup lang="ts">
import { type AvailabilityState, availabilityBadgeLabel } from "~/utils/availability"

// One badge for both universes (story 11.3). Gun Art passes its own edition
// wording ("16 / 25 disponibles"), the armurerie relies on the default — but the
// colour, the shape and the accessible semantics stay in one place instead of
// being reimplemented per page.
const props = withDefaults(
  defineProps<{
    state: AvailabilityState
    /** Overrides the default wording; the state still drives the styling. */
    label?: string
    size?: "sm" | "md"
  }>(),
  { size: "md" },
)

const text = computed(() => props.label ?? availabilityBadgeLabel(props.state))
</script>

<template>
  <span class="avail" :class="[`avail--${state}`, `avail--${size}`]">{{ text }}</span>
</template>

<style scoped>
/* Legibility is the requirement here, not discretion: a shopper must be able to
   tell at a glance that an item is gone. So the badge is opaque and
   high-contrast rather than a faint overlay — it sits on top of photographs of
   any brightness, where a translucent tint would become unreadable. No opacity
   tricks, no dimmed text: contrast is carried by real colours. */
.avail {
  border: 1px solid transparent;
  border-radius: 2px;
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.2;
  padding: 0.35rem 0.65rem;
  text-transform: uppercase;
  white-space: nowrap;
}
.avail--sm {
  font-size: 0.7rem;
  padding: 0.3rem 0.55rem;
}

/* Available: quiet on purpose — it is the expected state, and shouting it would
   drown out the one that actually needs to be noticed. */
.avail--available {
  background: color-mix(in srgb, var(--brass) 16%, var(--ink));
  border-color: var(--brass);
  color: var(--brass);
}

/* Unavailable: solid dark plate, near-white text — #f5f2ea on #0e0e10, about
   17:1, far above the 4.5:1 the guidelines ask for. It holds up over a bright
   photo, in grayscale, and for a colour-blind reader, because the wording
   carries the meaning and never the hue alone. */
.avail--sold,
.avail--out_of_stock {
  background: var(--ink);
  border-color: var(--paper);
  color: var(--paper);
}

@media (prefers-contrast: more) {
  .avail {
    border-width: 2px;
  }
}
</style>
