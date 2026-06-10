<template>
  <div class="site">
    <AppHeader />
    <main id="main">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>

<style scoped>
.site {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
main {
  flex: 1 0 auto;
}
</style>
