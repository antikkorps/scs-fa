<script setup lang="ts">
const { user, logout } = useAuth()

const nav = [
  { to: "/admin", label: "Tableau de bord", icon: "▤", exact: true },
  { to: "/admin/orders", label: "Commandes", icon: "▦" },
  { to: "/admin/blog", label: "Journal", icon: "✎" },
  { to: "/admin/legal-docs", label: "Documents", icon: "▣" },
  { to: "/admin/payments/virements", label: "Virements", icon: "▤" },
  { to: "/admin/metrics", label: "Métriques", icon: "▥" },
]

const mobileOpen = ref(false)
const route = useRoute()
watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false
  },
)

async function signOut() {
  logout()
  await navigateTo("/admin/login")
}
</script>

<template>
  <div class="admin" :class="{ 'admin--open': mobileOpen }">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand__mark">SCS</span>
        <span class="brand__sub">Administration</span>
      </div>
      <nav class="nav">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav__link"
          :class="{ 'nav__link--active': item.exact ? route.path === item.to : route.path.startsWith(item.to) }"
        >
          <span class="nav__icon" aria-hidden="true">{{ item.icon }}</span>
          {{ item.label }}
        </NuxtLink>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="burger" type="button" aria-label="Menu" @click="mobileOpen = !mobileOpen">☰</button>
        <div class="spacer" />
        <div class="account">
          <span class="account__name">{{ user?.firstName }} {{ user?.lastName }}</span>
          <button class="account__out" type="button" @click="signOut">Déconnexion</button>
        </div>
      </header>

      <div class="content">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr;
}
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 240px;
  transform: translateX(-100%);
  transition: transform 0.3s var(--ease);
  background: var(--ink-soft);
  border-right: 1px solid var(--ink-line);
  padding: 1.5rem 1rem;
  z-index: 40;
}
.admin--open .sidebar {
  transform: translateX(0);
}
.brand {
  display: flex;
  flex-direction: column;
  padding: 0 0.6rem 1.4rem;
  border-bottom: 1px solid var(--ink-line);
  margin-bottom: 1.2rem;
}
.brand__mark {
  font-family: var(--font-display);
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--brass);
}
.brand__sub {
  font-size: 0.66rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.nav__link {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem 0.8rem;
  border-radius: var(--radius);
  color: var(--paper-dim);
  font-size: 0.9rem;
  font-weight: 500;
  transition:
    background 0.2s var(--ease),
    color 0.2s var(--ease);
}
.nav__link:hover {
  background: rgba(255, 255, 255, 0.03);
  color: var(--paper);
}
.nav__link--active {
  background: rgba(200, 163, 91, 0.12);
  color: var(--brass);
}
.nav__icon {
  font-size: 1rem;
  width: 1.1rem;
  text-align: center;
}
.main {
  min-width: 0;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem var(--gutter);
  background: rgba(14, 14, 16, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--ink-line);
}
.burger {
  background: transparent;
  border: 1px solid var(--ink-line);
  color: var(--paper);
  border-radius: var(--radius);
  width: 2.3rem;
  height: 2.3rem;
  font-size: 1.1rem;
  cursor: pointer;
}
.spacer {
  flex: 1;
}
.account {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}
.account__name {
  font-size: 0.85rem;
  color: var(--paper-dim);
}
.account__out {
  background: transparent;
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
  padding: 0.45rem 0.9rem;
  border-radius: var(--radius);
  font-size: 0.78rem;
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s;
}
.account__out:hover {
  color: var(--brass);
  border-color: var(--brass);
}
.content {
  padding: clamp(1.4rem, 4vw, 2.4rem) var(--gutter) 4rem;
  max-width: 1180px;
}

/* Mobile scrim */
.admin--open::after {
  content: "";
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 35;
}

@media (min-width: 900px) {
  .admin {
    grid-template-columns: 240px 1fr;
  }
  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    transform: none;
  }
  .burger {
    display: none;
  }
  .admin--open::after {
    display: none;
  }
}
</style>
