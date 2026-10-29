<script setup lang="ts">
// Story 12.10 — the strip above the header before the opening: an administrator
// is told why they see a site the public does not; in the showcase stage every
// visitor is told that sales open soon, with the way to hear about it.
const { status } = useLaunch()

const message = computed(() => {
  if (status.value.launchStage === "coming_soon" && status.value.adminPreview) {
    return "Pré-ouverture — visible car vous êtes administrateur"
  }
  if (status.value.launchStage === "showcase") return "Les ventes ouvrent prochainement."
  return null
})
const offersNewsletter = computed(() => status.value.launchStage === "showcase")
</script>

<template>
  <div v-if="message" class="launch" role="status">
    {{ message }}
    <a v-if="offersNewsletter" href="#newsletter" class="launch__link">Être prévenu de l'ouverture</a>
  </div>
</template>

<style scoped>
.launch {
  background: var(--brass);
  color: var(--ink);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  text-align: center;
  padding: 0.5rem var(--gutter);
}
.launch__link {
  color: inherit;
  font-weight: var(--fw-semibold);
  margin-left: 0.5rem;
  text-decoration: underline;
}
</style>
