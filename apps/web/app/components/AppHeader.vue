<script setup lang="ts">
const route = useRoute()
const { isAuthenticated, user, isAdmin, logout } = useAuth()
const { count: cartCount } = useCart()

const mobileOpen = ref(false) // mobile full-screen menu
const searchOpen = ref(false) // desktop search panel
const accountOpen = ref(false) // desktop account dropdown
// The one open mega-panel: "gunart", or the slug of a shop menu tab (story 12.15c).
const megaOpen = ref<string | null>(null)

function closeAll() {
  mobileOpen.value = false
  searchOpen.value = false
  accountOpen.value = false
  megaOpen.value = null
}

// A panel opening (hover or focus) folds the search and account popovers away.
watch(megaOpen, (panel) => {
  if (!panel) return
  searchOpen.value = false
  accountOpen.value = false
})

// Close everything on navigation.
watch(() => route.fullPath, closeAll)

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeAll()
}
onMounted(() => window.addEventListener("keydown", onKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))

function toggleSearch() {
  accountOpen.value = false
  megaOpen.value = null
  searchOpen.value = !searchOpen.value
}
function toggleAccount() {
  searchOpen.value = false
  megaOpen.value = null
  accountOpen.value = !accountOpen.value
}

async function signOut() {
  await logout()
  closeAll()
  await navigateTo("/")
}
</script>

<template>
  <header class="hdr">
    <div class="container hdr__bar">
      <NuxtLink to="/" class="brand" aria-label="SCS Firearms — accueil" @click="closeAll">
        <AppLogo decorative />
      </NuxtLink>

      <nav class="nav" aria-label="Navigation principale">
        <!-- Story 12.15c: the house's two signature entries stand out; the shop
             itself moved to the menu row below. -->
        <NuxtLink to="/armes-de-collection" class="nav__link nav__link--feature">Armes de collection</NuxtLink>

        <MegaMenuItem
          panel-id="mega-gunart"
          :open="megaOpen === 'gunart'"
          @open="megaOpen = 'gunart'"
          @close="megaOpen = null"
        >
          <NuxtLink
            to="/collection"
            class="nav__link nav__link--feature nav__trigger"
            :class="{ 'is-open': megaOpen === 'gunart' }"
            :aria-expanded="megaOpen === 'gunart'"
            aria-controls="mega-gunart"
          >
            Gun Art
          </NuxtLink>
          <template #panel><GunArtMegaPanel /></template>
        </MegaMenuItem>

        <NuxtLink to="/blog" class="nav__link">Journal</NuxtLink>
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
                <NuxtLink to="/compte" class="menu__item" role="menuitem">Mon compte</NuxtLink>
                <NuxtLink to="/compte/commandes" class="menu__item" role="menuitem">Mes commandes</NuxtLink>
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
          :aria-expanded="mobileOpen"
          aria-controls="mobile-nav"
          aria-label="Ouvrir le menu"
          @click="mobileOpen = !mobileOpen"
        >
          <span :class="{ 'is-open': mobileOpen }" />
        </button>
      </div>
    </div>


    <!-- Story 12.15c: the shop menu's tabs, a row of their own on desktop. -->
    <div class="container hdr__shop">
      <ShopMenuBar v-model:open="megaOpen" />
    </div>

    <!-- Overlays are teleported to <body>: .hdr's backdrop-filter would otherwise
         trap their position:fixed inside the header. -->

    <!-- Account dropdown click-outside scrim -->
    <Teleport to="body">
      <button
        v-if="accountOpen"
        class="hdr-scrim"
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

    <HeaderMobileNav v-model:open="mobileOpen" @sign-out="signOut" />
  </header>
</template>

<style scoped src="../assets/css/header-mega.css"></style>
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
  align-items: center;
  flex-shrink: 0;
  --logo-height: 2.1rem;
}

/* Center spine */
.nav {
  display: none;
  align-items: center;
  gap: clamp(1rem, 2.6vw - 0.5rem, 2rem);
  margin: 0 auto;
}
.nav__link {
  /* « Gun Art », « À propos » must never break onto two lines. */
  white-space: nowrap;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  letter-spacing: var(--ls-wide);
  color: var(--paper-dim);
  transition: color 0.3s var(--ease);
}
.nav__link:hover,
.nav__link.router-link-active {
  color: var(--paper);
}
/* Story 12.15c: Armes de collection and Gun Art, the house's signature, read
   apart from the ordinary links: brass, a hairline pill and an ornament. */
.nav__link--feature {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.85rem;
  color: var(--brass);
  border: 1px solid color-mix(in srgb, var(--brass) 45%, transparent);
  border-radius: 999px;
  transition:
    color 0.3s var(--ease),
    border-color 0.3s var(--ease),
    background 0.3s var(--ease);
}
.nav__link--feature::before {
  /* Decorative: the empty alternative keeps screen readers from reading it. */
  content: "✦" / "";
  font-size: 0.7em;
}
.nav__link--feature:hover,
.nav__link--feature.is-open,
.nav__link--feature.router-link-active {
  color: var(--paper);
  border-color: var(--brass);
  background: color-mix(in srgb, var(--brass) 10%, transparent);
}

/* Second row: the shop menu. Desktop only, the burger carries it on mobile.
   Header height is then 68px + 44px. */
.hdr__shop {
  display: none;
  height: 44px;
  border-top: 1px solid var(--ink-line);
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
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
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
  font-size: var(--fs-sm);
  letter-spacing: var(--ls-normal);
  color: var(--brass);
  border-bottom: 1px solid var(--ink-line);
}
.menu__item {
  text-align: left;
  padding: 0.65rem 0.7rem;
  font-size: var(--fs-base);
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
  /* ⚠️ Must stay BELOW the header's z-index (50), not above it.
     `.hdr` is `position: sticky` with a z-index, so it opens a stacking
     context: the dropdown's own `z-index: 60` only ranks it inside the header,
     and the whole header still stacks at 50. A scrim at 55 therefore covered
     the menu it was meant to sit behind — every click landed on the scrim,
     which just closed the menu. The dropdown rendered perfectly and did
     nothing, connexion and inscription included.
     Below the header, the menu is clickable and a click anywhere else still
     closes it. */
  z-index: 40;
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
  font-size: var(--fs-base);
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
@media (min-width: 980px) {
  .nav,
  .hdr__shop {
    display: flex;
  }
  .burger {
    display: none;
  }
  .brand {
    --logo-height: 2.5rem;
  }
}
</style>
