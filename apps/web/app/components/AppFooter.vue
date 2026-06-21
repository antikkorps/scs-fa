<script setup lang="ts">
const year = new Date().getFullYear()
</script>

<template>
  <footer id="about" class="ft">
    <div class="container ft__grid">
      <div class="ft__brand">
        <p class="brand">
          <span class="brand__mark">SCS</span> <span class="brand__word">Firearm</span>
        </p>
        <p class="ft__tag">
          Gun Art — tirages d'art photographiques en édition strictement limitée, signés et numérotés.
        </p>
      </div>

      <nav class="ft__col" aria-label="Explorer">
        <h2 class="ft__h">Explorer</h2>
        <NuxtLink to="/collection">La collection</NuxtLink>
        <NuxtLink to="/blog">Le Journal</NuxtLink>
        <NuxtLink to="/">Accueil</NuxtLink>
      </nav>

      <div class="ft__col">
        <h2 class="ft__h">La maison</h2>
        <p>Chaque œuvre est livrée avec son certificat d'authenticité.</p>
      </div>
    </div>

    <div class="container ft__base">
      <p>© {{ year }} SCS Firearm. Tous droits réservés.</p>
      <p>Édition limitée · Fabriqué en France</p>
    </div>
  </footer>
</template>

<style scoped>
.ft {
  border-top: 1px solid var(--ink-line);
  background: var(--ink-soft);
  padding-top: clamp(2.5rem, 6vw, 4.5rem);
  margin-top: clamp(3rem, 8vw, 6rem);
}
.ft__grid {
  display: grid;
  gap: 2.5rem;
  grid-template-columns: 1fr;
  padding-bottom: 2.5rem;
}
.brand {
  font-family: var(--font-display);
  font-size: 1.4rem;
  margin: 0 0 0.75rem;
}
.brand__mark {
  color: var(--brass);
  font-weight: 700;
}
.ft__tag {
  color: var(--paper-dim);
  max-width: 34ch;
  margin: 0;
}
.ft__h {
  font-family: var(--font-body);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.22em;
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
.ft__base {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-block: 1.5rem;
  margin-top: 1.5rem;
  border-top: 1px solid var(--ink-line);
  font-size: 0.8rem;
  color: var(--paper-faint);
}

@media (min-width: 720px) {
  .ft__grid {
    grid-template-columns: 2fr 1fr 1fr;
  }
  .ft__base {
    flex-direction: row;
    justify-content: space-between;
  }
}
</style>
