<script setup lang="ts">
import { retailTotals, shippingClassLabel } from "@armurier/shared"
import type { CartView } from "~/types/cart"
import { formatEuros } from "~/utils/format"

// The totals of the cart and of the checkout (story 12.3): the customer must see
// the delivery cost — and so the full price — before ordering (C. conso. L221-5).
// An individual reads prices VAT included (audit 2026-11-01, I4): goods − VIP +
// delivery = total TTC, the VAT shown as part of it.
const props = defineProps<{ cart: CartView }>()

const summary = computed(() => props.cart.summary)
const totals = computed(() =>
  retailTotals({
    lines: [...props.cart.items, ...props.cart.artworkItems].map((line) => ({
      vatPct: line.vatPct,
      discountHt: line.discountAmount,
    })),
    shippingTtc: summary.value.shipping.totalTtc,
    vatAmount: summary.value.vatAmount,
    totalTtc: summary.value.totalTtc,
  }),
)
</script>

<template>
  <dl class="totals">
    <div>
      <dt>Articles</dt>
      <dd>{{ formatEuros(totals.itemsTtc) }}</dd>
    </div>
    <div v-if="totals.vipDiscountTtc > 0" class="totals__discount">
      <dt>Remise VIP</dt>
      <dd>− {{ formatEuros(totals.vipDiscountTtc) }}</dd>
    </div>
    <div v-if="summary.shipping.breakdown.length > 0" class="totals__shipping">
      <dt>Livraison</dt>
      <dd>{{ totals.shippingTtc > 0 ? formatEuros(totals.shippingTtc) : "Offerte" }}</dd>
      <ul class="totals__breakdown">
        <li v-for="entry in summary.shipping.breakdown" :key="entry.shippingClass">
          <span>{{ shippingClassLabel(entry) }}</span>
          <span>{{ entry.amountTtc > 0 ? `${formatEuros(entry.amountTtc)} TTC` : "offerte" }}</span>
        </li>
      </ul>
      <p v-if="summary.shipping.smallParcelFreeRemainingTtc !== null" class="totals__hint">
        Plus que {{ formatEuros(summary.shipping.smallParcelFreeRemainingTtc) }} de munitions ou d'accessoires pour
        profiter de la livraison offerte sur ces articles.
      </p>
    </div>
    <div class="totals__total">
      <dt>Total TTC</dt>
      <dd>{{ formatEuros(totals.totalTtc) }}</dd>
    </div>
    <div class="totals__vat">
      <dt>dont TVA</dt>
      <dd>{{ formatEuros(totals.vatAmount) }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.totals {
  margin: 0 0 1.25rem;
}
.totals > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 0.4rem 0;
}
.totals dt {
  color: var(--paper-dim);
}
.totals dd {
  margin: 0;
}
.totals__discount dd {
  color: var(--brass);
}
.totals__breakdown {
  flex-basis: 100%;
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.totals__breakdown li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.15rem 0;
}
.totals__breakdown li span:last-child {
  flex-shrink: 0;
}
.totals__hint {
  flex-basis: 100%;
  margin: 0.4rem 0 0;
  font-size: var(--fs-sm);
  color: var(--brass);
  line-height: var(--lh-normal);
}
.totals__vat {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.totals__total {
  border-top: 1px solid var(--ink-line);
  margin-top: 0.4rem;
  padding-top: 0.8rem !important;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
}
</style>
