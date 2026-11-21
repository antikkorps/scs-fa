<script setup lang="ts">
const route = useRoute()
const { isAuthenticated, user, isAdmin, logout } = useAuth()
const { count: cartCount } = useCart()

const mobileOpen = ref(false) // mobile full-screen menu
const searchOpen = ref(false) // desktop search panel
const accountOpen = ref(false) // desktop account dropdown
// The one open mega-panel of the universes' row: a tab's slug, "plus", or a
// signature's key (story 12.15c).
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

      <!-- Review of 12.15c (UI/UX): this row is the house; everything one
           buys, the two signatures included, is in the row below. -->
      <nav class="nav" aria-label="La maison">
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

    <!-- Story 12.15c: the universes and the signatures, a row of their own on desktop. -->
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

<style scoped src="../assets/css/header-feature.css"></style>
<style scoped src="../assets/css/header-bar.css"></style>
