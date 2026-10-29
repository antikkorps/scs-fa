<script setup lang="ts">
// Story 12.8c — in the public shop, an approved pro asks for a quote instead
// of buying: the article goes into their request being prepared. Stock does
// not stop a quote: SCS can order from the supplier.
const props = defineProps<{ variantId: string }>()

const { addToBasket } = useQuotes()
const adding = ref(false)
const added = ref(false)
const error = ref("")

const ERRORS: Record<string, string> = {
  NotAvailableForQuote: "Cet article n'est pas proposé sur devis.",
  QuantityTooLarge: "Cette ligne de votre demande est déjà au maximum.",
  BasketFull: "Votre demande est complète : envoyez-la, puis commencez-en une autre.",
  ShopNotOpen: SHOP_NOT_OPEN_MESSAGE,
}

async function add() {
  adding.value = true
  added.value = false
  error.value = ""
  try {
    await addToBasket(props.variantId, 1)
    added.value = true
  } catch (err) {
    error.value = ERRORS[apiErrorCode(err) ?? ""] ?? "Impossible d'ajouter cet article. Réessayez."
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="pro-quote">
    <button type="button" class="btn btn-primary buy" :disabled="adding" @click="add">
      {{ adding ? "Ajout…" : "Ajouter à ma demande de devis" }}
    </button>
    <p v-if="added" class="pro-quote__ok" role="status">
      Ajouté à votre demande. <NuxtLink to="/pro/demande">Voir ma demande</NuxtLink>
    </p>
    <p v-if="error" class="pro-quote__err" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.pro-quote__ok {
  margin: 0.7rem 0 0;
  color: var(--brass);
}
.pro-quote__ok a {
  color: inherit;
  text-decoration: underline;
}
.pro-quote__err {
  margin: 0.7rem 0 0;
  color: var(--danger);
}
</style>
