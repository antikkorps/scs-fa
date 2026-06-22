<script setup lang="ts">
const route = useRoute()
const { isAuthenticated, user, isAdmin, logout } = useAuth()
const { count: cartCount } = useCart()

const open = ref(false) // mobile full-screen menu
const searchOpen = ref(false) // desktop search panel
const accountOpen = ref(false) // desktop account dropdown

function closeAll() {
  open.value = false
  searchOpen.value = false
  accountOpen.value = false
}

// Close everything on navigation.
watch(() => route.fullPath, closeAll)

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeAll()
}
onMounted(() => window.addEventListener("keydown", onKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))

// Body scroll lock while the mobile overlay is open.
watch(open, (v) => {
  if (import.meta.client) document.body.style.overflow = v ? "hidden" : ""
})
onBeforeUnmount(() => {
  if (import.meta.client) document.body.style.overflow = ""
})

function toggleSearch() {
  accountOpen.value = false
  searchOpen.value = !searchOpen.value
}
function toggleAccount() {
  searchOpen.value = false
  accountOpen.value = !accountOpen.value
}

async function signOut() {
  await logout()
  closeAll()
  await navigateTo("/")
}

const NAV = [
  { to: "/boutique", label: "Armurerie" },
  { to: "/collection", label: "Gun Art" },
  { to: "/blog", label: "Journal" },
]
</script>

<template>
  <header class="hdr">
    <div class="container hdr__bar">
      <NuxtLink to="/" class="brand" aria-label="SCS Firearm — accueil" @click="closeAll">
        <span class="brand__mark">SCS</span>
        <span class="brand__word">Firearm</span>
      </NuxtLink>

      <nav class="nav" aria-label="Navigation principale">
        <NuxtLink v-for="item in NAV" :key="item.to" :to="item.to" class="nav__link">{{ item.label }}</NuxtLink>
        <a href="/#about" class="nav__link">La maison</a>
      </nav>

      <div class="actions">
        <!-- Search -->
        <button
          type="button"
          class="icon-btn"
          :aria-expanded="searchOpen"
          aria-label="Rechercher"
          aria-controls="search-panel"
          @click="toggleSearch"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
            />
          </svg>
        </button>

        <!-- Account -->
        <div class="account">
          <button
            type="button"
            class="icon-btn"
            :class="{ 'is-on': isAuthenticated }"
            :aria-expanded="accountOpen"
            aria-label="Mon compte"
            @click="toggleAccount"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
              />
            </svg>
          </button>
          <Transition name="drop">
            <div v-if="accountOpen" class="menu" role="menu">
              <template v-if="isAuthenticated">
                <p class="menu__hello">Bonjour {{ user?.firstName || "" }}</p>
                <NuxtLink v-if="isAdmin" to="/admin" class="menu__item" role="menuitem">Administration</NuxtLink>
                <button type="button" class="menu__item" role="menuitem" @click="signOut">Déconnexion</button>
              </template>
              <template v-else>
                <NuxtLink to="/connexion" class="menu__item" role="menuitem">Connexion</NuxtLink>
                <NuxtLink to="/inscription" class="menu__item" role="menuitem">Créer un compte</NuxtLink>
              </template>
            </div>
          </Transition>
        </div>

        <!-- Cart -->
        <NuxtLink to="/panier" class="icon-btn cart" aria-label="Panier">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6 6h15l-1.5 9h-12L5 3H2M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            />
          </svg>
          <span v-if="cartCount > 0" class="cart__badge">{{ cartCount }}</span>
        </NuxtLink>

        <!-- Burger (mobile) -->
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
    </div>

    <!-- Desktop search panel -->
    <Transition name="slide">
      <div v-if="searchOpen" id="search-panel" class="search-panel">
        <div class="container">
          <SearchBar large @submit="closeAll" />
        </div>
      </div>
    </Transition>
    <button v-if="searchOpen" class="scrim" aria-label="Fermer la recherche" @click="searchOpen = false" />
    <button v-if="accountOpen" class="scrim scrim--clear" aria-label="Fermer le menu" @click="accountOpen = false" />

    <!-- Mobile full-screen overlay -->
    <Transition name="overlay">
      <nav v-if="open" id="mobile-nav" class="mobile" aria-label="Navigation mobile">
        <SearchBar class="mobile__search" @submit="closeAll" />
        <NuxtLink v-for="item in NAV" :key="item.to" :to="item.to" class="mobile__link">{{ item.label }}</NuxtLink>
        <a href="/#about" class="mobile__link" @click="closeAll">La maison</a>
        <NuxtLink to="/panier" class="mobile__link">Panier<span v-if="cartCount > 0"> ({{ cartCount }})</span></NuxtLink>

        <div class="mobile__account">
          <template v-if="isAuthenticated">
            <NuxtLink v-if="isAdmin" to="/admin" class="mobile__link">Administration</NuxtLink>
            <button type="button" class="mobile__link mobile__signout" @click="signOut">Déconnexion</button>
          </template>
          <template v-else>
            <NuxtLink to="/connexion" class="mobile__link">Connexion</NuxtLink>
            <NuxtLink to="/inscription" class="mobile__link mobile__cta">Créer un compte</NuxtLink>
          </template>
        </div>
      </nav>
    </Transition>
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
  gap: 1rem;
  height: 68px;
}
.brand {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.5rem;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.brand__mark {
  color: var(--brass);
  font-weight: 700;
}
.brand__word {
  color: var(--paper);
  font-weight: 500;
}

/* Center spine */
.nav {
  display: none;
  align-items: center;
  gap: 2rem;
  margin: 0 auto;
}
.nav__link {
  font-size: 0.8rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-dim);
  transition: color 0.3s var(--ease);
}
.nav__link:hover,
.nav__link.router-link-active {
  color: var(--paper);
}

/* Right cluster */
.actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}
.icon-btn {
  position: relative;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--paper-dim);
  cursor: pointer;
  transition: color 0.3s var(--ease);
}
.icon-btn:hover {
  color: var(--brass);
}
.icon-btn.is-on {
  color: var(--brass);
}
.icon-btn svg {
  width: 22px;
  height: 22px;
}
.cart__badge {
  position: absolute;
  top: 6px;
  right: 4px;
  min-width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0 4px;
  font-size: 0.62rem;
  font-weight: 600;
  color: #1a1407;
  background: var(--brass);
  border-radius: 999px;
}

/* Account dropdown */
.account {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  min-width: 200px;
  padding: 0.5rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
}
.menu__hello {
  padding: 0.5rem 0.7rem;
  margin: 0 0 0.25rem;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--brass);
  border-bottom: 1px solid var(--ink-line);
}
.menu__item {
  text-align: left;
  padding: 0.65rem 0.7rem;
  font-size: 0.9rem;
  color: var(--paper);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
}
.menu__item:hover {
  background: var(--ink);
  color: var(--brass);
}

/* Scrims for click-outside */
.scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(8, 8, 10, 0.5);
  border: none;
  cursor: default;
}
.scrim--clear {
  background: transparent;
  z-index: 55;
}

/* Search panel (desktop) */
.search-panel {
  position: relative;
  z-index: 45;
  padding: 1rem 0 1.25rem;
  background: rgba(14, 14, 16, 0.95);
  border-bottom: 1px solid var(--ink-line);
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

/* Mobile full-screen overlay */
.mobile {
  position: fixed;
  inset: 68px 0 0;
  z-index: 48;
  display: flex;
  flex-direction: column;
  padding: clamp(1.25rem, 6vw, 2.5rem) var(--gutter) 2.5rem;
  background: var(--ink);
  overflow-y: auto;
}
.mobile__search {
  margin-bottom: 1.25rem;
}
.mobile__link {
  padding: 1rem 0;
  font-family: var(--font-display);
  font-size: 1.6rem;
  color: var(--paper);
  border-bottom: 1px solid var(--ink-line);
  text-align: left;
  background: transparent;
  width: 100%;
}
.mobile__account {
  margin-top: auto;
  padding-top: 1.5rem;
  display: flex;
  flex-direction: column;
}
.mobile__signout {
  border: none;
  cursor: pointer;
  color: var(--paper-dim);
  font-family: var(--font-display);
}
.mobile__cta {
  color: var(--brass);
}

/* Transitions */
.slide-enter-active,
.slide-leave-active {
  transition:
    opacity 0.25s var(--ease),
    transform 0.25s var(--ease);
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.drop-enter-active,
.drop-leave-active {
  transition:
    opacity 0.18s var(--ease),
    transform 0.18s var(--ease);
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.overlay-enter-active,
.overlay-leave-active {
  transition:
    opacity 0.3s var(--ease),
    transform 0.3s var(--ease);
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
  transform: translateY(-1.5%);
}

@media (min-width: 980px) {
  .nav {
    display: flex;
  }
  .burger {
    display: none;
  }
}
</style>
