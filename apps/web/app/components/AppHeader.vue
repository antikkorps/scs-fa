<script setup lang="ts">
const open = ref(false)
const route = useRoute()
const { isAuthenticated, user, logout } = useAuth()

// Close the mobile menu on navigation
watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)

async function signOut() {
  await logout()
  open.value = false
  await navigateTo("/")
}
</script>

<template>
  <header class="hdr">
    <div class="container hdr__bar">
      <NuxtLink to="/" class="brand" aria-label="SCS Firearm — accueil">
        <span class="brand__mark">SCS</span>
        <span class="brand__word">Firearm</span>
      </NuxtLink>

      <nav class="nav" aria-label="Navigation principale">
        <NuxtLink to="/collection" class="nav__link">Collection</NuxtLink>
        <NuxtLink to="/blog" class="nav__link">Journal</NuxtLink>
        <a href="#about" class="nav__link">La maison</a>
        <SearchBar class="nav__search" />
        <template v-if="isAuthenticated">
          <span class="nav__user">{{ user?.firstName || "Mon compte" }}</span>
          <button type="button" class="nav__link nav__signout" @click="signOut">Déconnexion</button>
        </template>
        <NuxtLink v-else to="/connexion" class="nav__link">Connexion</NuxtLink>
        <NuxtLink to="/collection" class="nav__cta btn btn-primary">Acquérir</NuxtLink>
      </nav>

      <button
        class="burger"
        :aria-expanded="open"
        aria-controls="mobile-nav"
        aria-label="Ouvrir le menu"
        @click="open = !open"
      >
        <span :class="{ 'is-open': open }" />
      </button>
    </div>

    <nav v-show="open" id="mobile-nav" class="mnav" aria-label="Navigation mobile">
      <SearchBar class="mnav__search" @submit="open = false" />
      <NuxtLink to="/collection" class="mnav__link">Collection</NuxtLink>
      <NuxtLink to="/blog" class="mnav__link">Journal</NuxtLink>
      <a href="#about" class="mnav__link">La maison</a>
      <template v-if="isAuthenticated">
        <span class="mnav__link mnav__user">{{ user?.firstName || "Mon compte" }}</span>
        <button type="button" class="mnav__link mnav__signout" @click="signOut">Déconnexion</button>
      </template>
      <NuxtLink v-else to="/connexion" class="mnav__link">Connexion</NuxtLink>
      <NuxtLink to="/collection" class="mnav__link mnav__cta">Acquérir une œuvre</NuxtLink>
    </nav>
  </header>
</template>

<style scoped>
.hdr {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(14, 14, 16, 0.78);
  backdrop-filter: saturate(150%) blur(12px);
  border-bottom: 1px solid var(--ink-line);
}
.hdr__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 68px;
}
.brand {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.5rem;
  letter-spacing: 0.04em;
}
.brand__mark {
  color: var(--brass);
  font-weight: 700;
}
.brand__word {
  color: var(--paper);
  font-weight: 500;
}
.nav {
  display: none;
  align-items: center;
  gap: 2rem;
}
.nav__link {
  font-size: 0.82rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-dim);
  transition: color 0.3s var(--ease);
}
.nav__link:hover {
  color: var(--paper);
}
.nav__user {
  font-size: 0.82rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brass);
}
.nav__signout {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
}
.mnav__user {
  color: var(--brass);
}
.mnav__signout {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--ink-line);
  padding: 0.9rem 0;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.nav__search {
  width: 230px;
}
.nav__cta {
  padding: 0.6rem 1.2rem;
}

/* Burger */
.burger {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  cursor: pointer;
}
.burger span,
.burger span::before,
.burger span::after {
  content: "";
  display: block;
  width: 18px;
  height: 1.5px;
  background: var(--paper);
  transition: transform 0.3s var(--ease);
}
.burger span {
  position: relative;
}
.burger span::before {
  position: absolute;
  top: -6px;
}
.burger span::after {
  position: absolute;
  top: 6px;
}
.burger span.is-open {
  background: transparent;
}
.burger span.is-open::before {
  transform: translateY(6px) rotate(45deg);
}
.burger span.is-open::after {
  transform: translateY(-6px) rotate(-45deg);
}

.mnav {
  display: flex;
  flex-direction: column;
  padding: 0.5rem var(--gutter) 1.25rem;
  border-top: 1px solid var(--ink-line);
}
.mnav__search {
  margin: 0.25rem 0 0.75rem;
}
.mnav__link {
  padding: 0.9rem 0;
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  color: var(--paper-dim);
  border-bottom: 1px solid var(--ink-line);
}
.mnav__cta {
  color: var(--brass);
  font-weight: 600;
  border-bottom: none;
}

@media (min-width: 820px) {
  .nav {
    display: flex;
  }
  .burger,
  .mnav {
    display: none;
  }
}
</style>
