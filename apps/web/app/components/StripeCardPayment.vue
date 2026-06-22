<script setup lang="ts">
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js"
import { formatEuros } from "~/utils/format"

const props = defineProps<{ orderId: string; amount: number }>()
const emit = defineEmits<{ paid: [] }>()

const { createStripeIntent } = useOrders()
const pk = useRuntimeConfig().public.stripePublishableKey as string

const elRef = ref<HTMLElement | null>(null)
const ready = ref(false)
const loadError = ref("")
const payError = ref("")
const paying = ref(false)

let stripe: Stripe | null = null
let elements: StripeElements | null = null

// Stripe.js is browser-only; onMounted runs client-side only in Nuxt.
onMounted(async () => {
  if (!pk) {
    loadError.value = "Le paiement par carte n'est pas configuré."
    return
  }
  try {
    const { clientSecret } = await createStripeIntent(props.orderId)
    stripe = await loadStripe(pk)
    if (!stripe) {
      loadError.value = "Stripe est indisponible pour le moment."
      return
    }
    elements = stripe.elements({
      clientSecret,
      appearance: { theme: "night", variables: { colorPrimary: "#c8a35b", borderRadius: "4px" } },
    })
    const paymentEl = elements.create("payment")
    if (elRef.value) paymentEl.mount(elRef.value)
    ready.value = true
  } catch (err) {
    // 409 = the card bucket is already settled (e.g. page reloaded after paying).
    if (authErrorStatus(err) === 409) {
      emit("paid")
      return
    }
    loadError.value = "Impossible d'initialiser le paiement par carte."
  }
})

async function pay() {
  if (!stripe || !elements) return
  paying.value = true
  payError.value = ""
  const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" })
  if (error) {
    payError.value = error.message ?? "Le paiement a échoué. Vérifiez votre carte."
    paying.value = false
    return
  }
  if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
    emit("paid")
    return
  }
  payError.value = "Le paiement n'a pas pu être confirmé."
  paying.value = false
}
</script>

<template>
  <div class="card-pay">
    <p v-if="loadError" class="card-pay__err" role="alert">{{ loadError }}</p>
    <template v-else>
      <div ref="elRef" class="card-pay__el" />
      <button type="button" class="btn btn-primary card-pay__btn" :disabled="!ready || paying" @click="pay">
        {{ paying ? "Paiement…" : `Payer ${formatEuros(amount)}` }}
      </button>
      <p v-if="payError" class="card-pay__err" role="alert">{{ payError }}</p>
      <p class="card-pay__test">Test : carte 4242 4242 4242 4242, date future, CVC libre.</p>
    </template>
  </div>
</template>

<style scoped>
.card-pay__el {
  margin-bottom: 1.1rem;
}
.card-pay__btn {
  width: 100%;
  justify-content: center;
}
.card-pay__err {
  margin: 0.85rem 0 0;
  font-size: 0.88rem;
  color: var(--danger);
}
.card-pay__test {
  margin: 0.85rem 0 0;
  font-size: 0.78rem;
  color: var(--paper-faint);
}
</style>
