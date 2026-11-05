<script setup lang="ts">
// The acting admin's password and app code, asked before any change that a
// stolen admin session alone must not make (review and request 2026-11-04):
// resetting someone's second factor, inviting an admin, taking an access back.
// Admins always have the app, so the code is always asked.
const password = defineModel<string>("password", { required: true })
const code = defineModel<string>("code", { required: true })
</script>

<template>
  <div class="reauth-fields">
    <label class="field">
      <span>Votre mot de passe</span>
      <input v-model="password" class="ctl" type="password" name="admin-password" autocomplete="current-password" required />
    </label>
    <label class="field">
      <span>Code de votre application</span>
      <input
        v-model="code"
        class="ctl"
        type="text"
        name="admin-code"
        inputmode="numeric"
        autocomplete="one-time-code"
        required
      />
    </label>
  </div>
</template>

<style scoped>
.field {
  display: block;
  margin-bottom: 0.9rem;
}
.field span {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.ctl {
  width: 100%;
  padding: 0.6rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
</style>
