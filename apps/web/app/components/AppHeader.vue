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
        <a href="/#about" class="nav__link">À propos</a>
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

    <!-- Overlays are teleported to <body>: .hdr's backdrop-filter would otherwise
         trap their position:fixed inside the 68px-tall header. -->

    <!-- Account dropdown click-outside scrim -->
    <Teleport to="body">
      <button
        v-if="accountOpen"
        class="hdr-scrim hdr-scrim--clear"
        aria-label="Fermer le menu"
        @click="accountOpen = false"
      />
    </Teleport>

    <!-- Search overlay -->
    <Teleport to="body">
      <Transition name="searchov">
        <div
          v-if="searchOpen"
          class="searchov"
          role="dialog"
          aria-modal="true"
          aria-label="Recherche"
          @click.self="searchOpen = false"
        >
          <div class="searchov__panel">
            <SearchBar large @submit="closeAll" />
            <button type="button" class="searchov__close" aria-label="Fermer" @click="searchOpen = false">✕</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Mobile full-screen overlay -->
    <Teleport to="body">
      <Transition name="overlay">
        <nav v-if="open" id="mobile-nav" class="mobile" aria-label="Navigation mobile">
          <div class="mobile__top">
            <span class="brand">
              <span class="brand__mark">SCS</span><span class="brand__word">Firearm</span>
            </span>
            <button type="button" class="mobile__close" aria-label="Fermer le menu" @click="open = false">✕</button>
          </div>

          <div class="mobile__body">
            <SearchBar class="mobile__search" @submit="closeAll" />

            <ul class="mobile__nav" role="list">
              <li v-for="(item, i) in NAV" :key="item.to" :style="{ '--i': i }">
                <NuxtLink :to="item.to" class="mlink">
                  <span>{{ item.label }}</span><span class="mlink__chev" aria-hidden="true">›</span>
                </NuxtLink>
              </li>
              <li :style="{ '--i': NAV.length }">
                <a href="/#about" class="mlink" @click="closeAll">
                  <span>À propos</span><span class="mlink__chev" aria-hidden="true">›</span>
                </a>
              </li>
            </ul>

            <div class="mobile__foot">
              <NuxtLink to="/panier" class="mfoot">
                <span>Panier</span>
                <span v-if="cartCount > 0" class="mfoot__badge">{{ cartCount }}</span>
              </NuxtLink>
              <template v-if="isAuthenticated">
                <NuxtLink v-if="isAdmin" to="/admin" class="mfoot">Administration</NuxtLink>
                <button type="button" class="mfoot mfoot--btn" @click="signOut">Déconnexion</button>
              </template>
              <template v-else>
                <NuxtLink to="/connexion" class="mfoot">Connexion</NuxtLink>
                <NuxtLink to="/inscription" class="mfoot mfoot--accent">Créer un compte</NuxtLink>
              </template>
            </div>
          </div>
        </nav>
      </Transition>
    </Teleport>
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

/* Transparent click-outside scrim for the account dropdown */
.hdr-scrim {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: transparent;
  border: none;
  cursor: default;
}

/* Search overlay (dims the page, panel near the top) */
.searchov {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  justify-content: center;
  padding: clamp(4rem, 14vh, 9rem) var(--gutter) 2rem;
  background: rgba(8, 8, 10, 0.7);
  backdrop-filter: blur(6px);
}
.searchov__panel {
  position: relative;
  width: 100%;
  max-width: 640px;
  height: max-content;
}
.searchov__close {
  position: absolute;
  top: -2.6rem;
  right: 0;
  width: 40px;
  height: 40px;
  font-size: 1rem;
  color: var(--paper);
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  cursor: pointer;
}
.searchov__close:hover {
  color: var(--brass);
  border-color: var(--brass);
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

/* Mobile full-screen overlay (teleported to body → full viewport) */
.mobile {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  padding: 0 var(--gutter) 2.5rem;
  background: var(--ink);
  overflow-y: auto;
}
.mobile__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 68px;
  margin-bottom: 1rem;
}
.mobile__top .brand {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.5rem;
}
.mobile__close {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
  color: var(--paper);
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  cursor: pointer;
}
.mobile__close:hover {
  color: var(--brass);
  border-color: var(--brass);
}
.mobile__body {
  display: flex;
  flex-direction: column;
  flex: 1;
}
.mobile__search {
  margin-bottom: 1.5rem;
}
.mobile__nav {
  list-style: none;
  margin: 0;
  padding: 0;
}
.mlink {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 1.15rem 0.25rem;
  font-size: 1.25rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--paper);
  border-bottom: 1px solid var(--ink-line);
  transition: color 0.25s var(--ease);
}
.mlink:hover,
.mlink:active,
.mlink.router-link-active {
  color: var(--brass);
}
.mlink__chev {
  color: var(--brass);
  font-size: 1.4rem;
  line-height: 1;
}
.mobile__foot {
  margin-top: auto;
  padding-top: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.mfoot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 0.25rem;
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--paper-dim);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: color 0.25s var(--ease);
}
.mfoot:hover {
  color: var(--paper);
}
.mfoot--accent {
  color: var(--brass);
}
.mfoot__badge {
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 0.68rem;
  color: #1a1407;
  background: var(--brass);
  border-radius: 999px;
}

/* Staggered reveal of the mobile menu content */
.mobile__search,
.mobile__nav li,
.mobile__foot > * {
  animation: riseIn 0.4s var(--ease) both;
}
.mobile__search {
  animation-delay: 0.04s;
}
.mobile__nav li {
  animation-delay: calc(var(--i) * 55ms + 0.1s);
}
.mobile__foot > * {
  animation-delay: 0.34s;
}
@keyframes riseIn {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* Transitions */
.searchov-enter-active,
.searchov-leave-active {
  transition: opacity 0.2s var(--ease);
}
.searchov-enter-active .searchov__panel,
.searchov-leave-active .searchov__panel {
  transition: transform 0.25s var(--ease);
}
.searchov-enter-from,
.searchov-leave-to {
  opacity: 0;
}
.searchov-enter-from .searchov__panel,
.searchov-leave-to .searchov__panel {
  transform: translateY(-12px);
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
.overlay-enter-active {
  transition: opacity 0.28s var(--ease);
}
/* Softer, slightly longer exit: fade + gentle slide-down instead of a hard cut. */
.overlay-leave-active {
  transition:
    opacity 0.38s var(--ease),
    transform 0.38s var(--ease);
}
.overlay-enter-from {
  opacity: 0;
}
.overlay-leave-to {
  opacity: 0;
  transform: translateY(16px);
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
