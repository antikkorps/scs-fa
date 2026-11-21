<script setup lang="ts">
// The header's full-screen mobile menu. Teleported to <body>: the header's
// backdrop-filter would otherwise trap its position:fixed inside the header.
const open = defineModel<boolean>("open", { default: false })
const emit = defineEmits<{ "sign-out": [] }>()

const { isAuthenticated, isAdmin } = useAuth()
const { count: cartCount } = useCart()
const { menu } = useShopMenu()
// The rows after the shop tabs carry on the staggered reveal (+1: "Toute la boutique").
const rank = (offset: number) => ({ "--i": menu.value.length + 1 + offset })

function close() {
  open.value = false
}

// Body scroll lock while the overlay is open.
watch(open, (isOpen) => {
  if (import.meta.client) document.body.style.overflow = isOpen ? "hidden" : ""
})
onBeforeUnmount(() => {
  if (import.meta.client) document.body.style.overflow = ""
})
</script>

<template>
  <Teleport to="body">
    <Transition name="overlay">
      <nav v-if="open" id="mobile-nav" class="mobile" aria-label="Navigation mobile">
        <div class="mobile__top">
          <AppLogo class="brand" />
          <button type="button" class="mobile__close" aria-label="Fermer le menu" @click="close">✕</button>
        </div>

        <div class="mobile__body">
          <SearchBar class="mobile__search" @submit="close" />

          <ShopMenuMobile />

          <ul class="mnav" role="list">
            <li class="mnav__item" :style="rank(0)">
              <NuxtLink to="/armes-de-collection" class="mlink mlink--feature">
                <span>Armes de collection</span><span class="mlink__chev" aria-hidden="true">›</span>
              </NuxtLink>
            </li>
            <li class="mnav__item" :style="rank(1)">
              <MobileNavAccordion panel-id="msub-gunart" label="Gun Art" featured>
                <li><NuxtLink to="/collection/artiste" class="msub__link">L'artiste</NuxtLink></li>
                <li><NuxtLink to="/collection" class="msub__link">Voir la collection</NuxtLink></li>
                <li class="msub__note">Éditions limitées ≤ 25, signées, numérotées &amp; certifiées</li>
              </MobileNavAccordion>
            </li>
            <li class="mnav__item" :style="rank(2)">
              <NuxtLink to="/blog" class="mlink">
                <span>Journal</span><span class="mlink__chev" aria-hidden="true">›</span>
              </NuxtLink>
            </li>
            <li class="mnav__item" :style="rank(3)">
              <a href="/#about" class="mlink" @click="close">
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
              <NuxtLink to="/compte" class="mfoot">Mon compte</NuxtLink>
              <NuxtLink to="/compte/commandes" class="mfoot">Mes commandes</NuxtLink>
              <NuxtLink v-if="isAdmin" to="/admin" class="mfoot">Administration</NuxtLink>
              <button type="button" class="mfoot mfoot--btn" @click="emit('sign-out')">Déconnexion</button>
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
</template>

<style scoped src="../assets/css/header-mobile.css"></style>
<style scoped>
/* Full-screen overlay (teleported to body → full viewport) */
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
  --logo-height: 2.1rem;
}
.mobile__close {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
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
  font-size: var(--fs-base);
  letter-spacing: var(--ls-normal);
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
  font-size: var(--fs-sm);
  color: #1a1407;
  background: var(--brass);
  border-radius: 999px;
}

/* The search shows first, the account links last (see header-mobile.css). */
.mobile__search {
  --delay: 0.04s;
}
.mobile__foot {
  --delay: 0.34s;
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
</style>
