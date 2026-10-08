<script setup lang="ts">
// The one place the brand file is named: to change the logo, replace the file
// (or this import) and every header, footer and sidebar follows.
import logoUrl from "~/assets/logo/scs-A-horizontal.svg"

// The file's own viewBox: an explicit size lets the browser reserve the box
// before the image arrives (no layout shift), CSS then scales it by height.
const LOGO_WIDTH = 735
const LOGO_HEIGHT = 172

const props = withDefaults(defineProps<{ decorative?: boolean }>(), { decorative: false })

// Inside a link that already carries an aria-label, a second name would be read twice.
const alt = computed(() => (props.decorative ? "" : "SCS Firearms"))
</script>

<template>
  <img class="logo" :src="logoUrl" :alt="alt" :width="LOGO_WIDTH" :height="LOGO_HEIGHT" decoding="async" />
</template>

<style scoped>
.logo {
  display: block;
  height: var(--logo-height, 2rem);
  width: auto;
}
</style>
