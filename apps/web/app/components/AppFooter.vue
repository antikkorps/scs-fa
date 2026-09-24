<script setup lang="ts">
const year = new Date().getFullYear()
// Changing one's mind must be as easy as the first choice (story 9.6).
const { reopen } = useConsent()
</script>

<template>
  <footer class="ft">
    <div class="container ft__grid">
      <div class="ft__brand">
        <p class="brand">
          <span class="brand__mark">SCS</span> <span class="brand__word">Firearm</span>
        </p>
        <p class="ft__tag">
          Armurerie de précision &amp; galerie Gun Art — du fonctionnel à l'œuvre d'art, avec exigence et conformité
          réglementaire.
        </p>
      </div>

      <nav class="ft__col" aria-label="Explorer">
        <h2 class="ft__h">Explorer</h2>
        <NuxtLink to="/boutique">Armurerie</NuxtLink>
        <NuxtLink to="/armes-de-collection">Armes de collection</NuxtLink>
        <NuxtLink to="/collection">Gun Art</NuxtLink>
        <NuxtLink to="/collection/artiste">L'artiste</NuxtLink>
        <NuxtLink to="/blog">Journal</NuxtLink>
      </nav>

      <nav class="ft__col" aria-label="La maison">
        <h2 class="ft__h">La maison</h2>
        <NuxtLink to="/#about">À propos</NuxtLink>
        <NuxtLink to="/compte">Mon compte</NuxtLink>
        <NuxtLink to="/panier">Panier</NuxtLink>
      </nav>

      <div class="ft__news">
        <NewsletterSignup
          variant="bare"
          source="/"
          title="Rester informé"
          description="Nouveautés de l'armurerie, pièces de collection et tirages Gun Art. Quelques envois par an, désabonnement en un clic."
        />
      </div>
    </div>

    <div class="container ft__base">
      <p>© {{ year }} SCS Firearm. Tous droits réservés.</p>
      <nav class="ft__legal" aria-label="Informations légales">
        <NuxtLink to="/confidentialite">Confidentialité</NuxtLink>
        <button type="button" class="ft__linkbtn" @click="reopen">Gestion des cookies</button>
      </nav>
      <p>Édition limitée · Fabriqué en France</p>
    </div>
  </footer>
</template>

<style scoped>
.ft__legal {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.25rem;
}
.ft__legal a,
.ft__linkbtn {
  color: inherit;
  text-decoration: none;
}
.ft__legal a:hover,
.ft__linkbtn:hover {
  color: var(--brass);
}
.ft__linkbtn {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  cursor: pointer;
}
.ft {
  border-top: 1px solid var(--ink-line);
  background: var(--ink-soft);
  padding-top: clamp(2.5rem, 6vw, 4.5rem);
  margin-top: clamp(3rem, 8vw, 6rem);
}
.ft__grid {
  display: grid;
  gap: 2.5rem 3rem;
  grid-template-columns: 1fr;
  padding-bottom: 2.5rem;
}
.brand {
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  margin: 0 0 0.75rem;
}
.brand__mark {
  color: var(--brass);
  font-weight: var(--fw-bold);
}
.ft__tag {
  color: var(--paper-dim);
  max-width: 34ch;
  margin: 0;
}
.ft__h {
  font-family: var(--font-body);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--brass);
  margin: 0 0 1rem;
}
.ft__col {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.ft__col a,
.ft__col p {
  color: var(--paper-dim);
  margin: 0;
  transition: color 0.3s var(--ease);
}
.ft__col a:hover {
  color: var(--paper);
}
/* The signup carries its own heading style, which is right on a product page
   but breaks the row here: three brass micro-labels and one display title, on
   four different baselines. In the footer it is a column head like the others. */
.ft__news :deep(.nl__title) {
  font-family: var(--font-body);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--brass);
  margin: 0 0 1rem;
}
.ft__news :deep(.nl__desc) {
  font-size: var(--fs-sm);
}

.ft__base {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-block: 1.5rem;
  margin-top: 1.5rem;
  border-top: 1px solid var(--ink-line);
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}

/* Two tiers rather than four cramped columns: identity and navigation on one
   row, the signup beside them once there is room.

   The previous rule declared three columns for four blocks and gave the signup
   `grid-column: 1 / -1`, so "La maison" was pushed onto a third row of its own
   and the form stretched the full width as a banner. */
@media (min-width: 720px) {
  .ft__grid {
    grid-template-columns: 1.6fr 1fr 1fr;
  }
  .ft__news {
    grid-column: 1 / -1;
    max-width: 46rem;
  }
  .ft__base {
    flex-direction: row;
    justify-content: space-between;
  }
}

@media (min-width: 1080px) {
  /* The signup takes the fourth column and stops reading as a banner. */
  .ft__grid {
    grid-template-columns: 1.5fr 0.9fr 0.9fr 1.7fr;
  }
  .ft__news {
    grid-column: auto;
    max-width: none;
  }
}
</style>
