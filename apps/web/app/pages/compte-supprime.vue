<script setup lang="ts">
// Story 12.11 — where a holder lands after deleting their account (no session left).
useHead({ title: "Compte supprimé — SCS Firearms" })
</script>

<template>
  <div class="auth-wrap">
    <section class="auth-card">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Votre compte a été supprimé</h1>
      <p class="auth-card__lede">
        Vos coordonnées, votre carnet d'adresses, votre panier et votre inscription à la lettre d'information sont
        effacés. Un e-mail de confirmation vous a été envoyé.
      </p>
      <p class="auth-card__lede">
        La loi nous oblige à conserver vos commandes et leurs factures pendant 10 ans, ainsi que les pièces
        justificatives qui ont servi à une commande d'arme : elles seront supprimées au terme de ce délai.
      </p>
      <NuxtLink to="/" class="btn btn-primary auth-submit">Retour à l'accueil</NuxtLink>
    </section>
  </div>
</template>
