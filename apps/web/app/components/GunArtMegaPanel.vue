<template>
  <div class="gunart">
    <div class="gunart__pitch">
      <p class="mega__label">Gun Art</p>
      <p class="gunart__lede">
        Des tirages photographiques d'exception, signés et numérotés, en édition strictement limitée.
      </p>
      <ul class="gunart__points" role="list">
        <li>Éditions limitées ≤ 25 exemplaires</li>
        <li>Signées &amp; numérotées</li>
        <li>Certificat d'authenticité</li>
      </ul>
    </div>
    <div class="gunart__ctas">
      <!-- The artist comes first: the house sells someone's work, and
           that is the entry point into Gun Art (Franck, 2026-09-23).
           `/collection/artiste` routes to the artist when there is
           only one, and lists them once there are several. -->
      <NuxtLink to="/collection/artiste" class="mega__cta">
        <span class="mega__cta-title">L'artiste <span class="mega__cta-arrow" aria-hidden="true">→</span></span>
        <span class="mega__cta-sub">Celui dont vous accrochez le travail</span>
      </NuxtLink>
      <NuxtLink to="/collection" class="mega__cta">
        <span class="mega__cta-title">Découvrir la collection <span class="mega__cta-arrow" aria-hidden="true">→</span></span>
        <span class="mega__cta-sub">La galerie Gun Art</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped src="../assets/css/header-mega.css"></style>
<style scoped>
.gunart {
  display: flex;
  gap: 2.5rem;
  min-width: 400px;
}
.gunart__pitch {
  max-width: 260px;
}
.gunart__lede {
  margin: 0 0 0.9rem;
  font-size: var(--fs-base);
  line-height: var(--lh-relaxed);
  color: var(--paper-dim);
}
.gunart__points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.gunart__points li {
  position: relative;
  padding-left: 1.1rem;
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}
.gunart__points li::before {
  content: "›";
  position: absolute;
  left: 0;
  color: var(--brass);
}
.gunart__ctas {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-self: center;
}
</style>
