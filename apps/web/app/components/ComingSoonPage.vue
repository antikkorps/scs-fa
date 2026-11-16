<script setup lang="ts">
/**
 * The waiting page (story 12.10): what every public page answers before the
 * opening. It stands alone — no header or footer, whose links lead to pages
 * that are themselves closed — and keeps the two things a visitor can still do:
 * leave an address for the opening, and read who runs the site.
 */
useHead({ title: "Ouverture prochaine" })
useSeoMeta({
  description: "SCS Firearms, armurerie en ligne et galerie Gun Art, ouvre prochainement.",
  robots: "noindex",
})
</script>

<template>
  <main id="main" class="soon">
    <div class="soon__inner">
      <div class="soon__intro">
        <AppLogo class="soon__logo" />
        <p class="eyebrow">Armurerie &amp; Gun Art</p>
        <h1 class="soon__title">Ouverture prochaine</h1>
        <p class="soon__lede">
          L'armurerie en ligne et la galerie Gun Art ouvrent bientôt. Laissez votre adresse : vous serez prévenu de
          l'ouverture.
        </p>
      </div>
      <!-- No universe to stand in here, so nothing is pre-ticked: the visitor chooses. -->
      <NewsletterSignup
        class="soon__signup"
        source="/ouverture-prochaine"
        :default-segments="[]"
        title="Être prévenu de l'ouverture"
      />
      <nav class="soon__legal" aria-label="Informations légales">
        <NuxtLink to="/mentions-legales">Mentions légales</NuxtLink>
        <NuxtLink to="/confidentialite">Confidentialité</NuxtLink>
      </nav>
    </div>
  </main>
</template>

<style scoped>
/* One screen, no scroll on a laptop: side by side from 960px (the form alone is
   ~460px tall), stacked and tightened below. svh, not vh: a phone's address bar
   would otherwise push the bottom of the page out of view. */
.soon {
  /* Fallback for browsers without svh (Safari < 15.4). */
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: 1.5rem var(--gutter);
}
.soon__inner {
  width: 100%;
  max-width: 34rem;
  display: grid;
  gap: 1.5rem;
  text-align: center;
}
.soon__logo {
  margin: 0 auto 1.25rem;
}
.soon__title {
  font-family: var(--font-display);
  font-size: var(--fs-2xl);
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-display);
  margin: 0.5rem 0 1rem;
}
.soon__lede {
  color: var(--paper-dim);
  font-size: var(--fs-md);
  line-height: var(--lh-relaxed);
  margin: 0;
}
.soon :deep(.nl) {
  text-align: left;
}
.soon__legal {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  font-size: var(--fs-sm);
}
.soon__legal a {
  color: var(--paper-faint);
}
.soon__legal a:hover {
  color: var(--paper);
}

@media (min-width: 960px) {
  .soon__inner {
    max-width: 68rem;
    grid-template-columns: 1fr minmax(0, 30rem);
    grid-template-areas:
      "intro signup"
      "legal signup";
    grid-template-rows: 1fr auto;
    column-gap: clamp(3rem, 6vw, 6rem);
    align-items: center;
    text-align: left;
  }
  .soon__intro {
    grid-area: intro;
  }
  .soon__signup {
    grid-area: signup;
  }
  .soon__legal {
    grid-area: legal;
    justify-content: flex-start;
  }
  .soon__logo {
    margin: 0 0 2rem;
  }
  .soon__title {
    font-size: var(--fs-3xl);
  }
}
</style>
