<script setup lang="ts">
// Story 12.15c — the shop menu in the mobile overlay: a tab with children
// folds out its entries (three levels at most), the others are plain links.
const { menu } = useShopMenu()
</script>

<template>
  <!-- Review of 12.15c (UI/UX): the list says what the tabs are. -->
  <h2 id="mnav-universes" class="mnav__title">Nos univers</h2>
  <ul class="mnav mnav--universes" aria-labelledby="mnav-universes" role="list">
    <li v-for="(tab, index) in menu" :key="tab.path" class="mnav__item" :style="{ '--i': index }">
      <MobileNavAccordion v-if="tab.children.length" :panel-id="`msub-${tab.slug}`" :label="tab.label">
        <li v-if="tab.href">
          <NuxtLink :to="tab.href" class="msub__link msub__link--all">Voir tout « {{ tab.label }} »</NuxtLink>
        </li>
        <li v-for="entry in tab.children" :key="entry.path">
          <NuxtLink v-if="entry.href" :to="entry.href" class="msub__link">{{ entry.label }}</NuxtLink>
          <span v-else class="msub__heading">{{ entry.label }}</span>
          <ul v-if="entry.children.length" class="msub__deep" role="list">
            <li v-for="leaf in entry.children" :key="leaf.path">
              <NuxtLink v-if="leaf.href" :to="leaf.href" class="msub__link">{{ leaf.label }}</NuxtLink>
              <span v-else class="msub__heading">{{ leaf.label }}</span>
            </li>
          </ul>
        </li>
      </MobileNavAccordion>
      <NuxtLink v-else-if="tab.href" :to="tab.href" class="mlink">
        <span>{{ tab.label }}</span><span class="mlink__chev" aria-hidden="true">›</span>
      </NuxtLink>
    </li>
    <li class="mnav__item" :style="{ '--i': menu.length }">
      <NuxtLink to="/boutique" class="mlink mlink--quiet">
        <span>Voir tous les univers</span><span class="mlink__chev" aria-hidden="true">›</span>
      </NuxtLink>
    </li>
  </ul>
</template>

<style scoped src="../assets/css/header-mobile.css"></style>
<style scoped>
.mnav__title {
  margin: 0;
  padding: 0 0.25rem 0.25rem;
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--brass);
}
.msub__link--all {
  color: var(--brass);
}
.msub__heading {
  display: block;
  padding: 0.8rem 0.25rem 0.3rem 1rem;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
}
/* The third level sits indented under its parent. */
.msub__deep {
  list-style: none;
  margin: 0;
  padding: 0 0 0 1rem;
}
.msub__deep .msub__link {
  padding-block: 0.45rem;
  font-size: var(--fs-sm);
}
</style>
