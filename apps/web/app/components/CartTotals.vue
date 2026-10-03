<script setup lang="ts">
import { shippingClassLabel } from "@armurier/shared"
import type { CartSummary } from "~/types/cart"
import { formatEuros } from "~/utils/format"

// The totals of the cart and of the checkout (story 12.3): the customer must see
// the delivery cost — and so the full price — before ordering (C. conso. L221-5).
// Rows add up: HT − VIP + delivery HT + VAT = total TTC.
defineProps<{ summary: CartSummary }>()
</script>

<template>
  <dl class="totals">
    <div>
      <dt>Sous-total HT</dt>
      <dd>{{ formatEuros(summary.subtotalHt) }}</dd>
    </div>
    <div v-if="summary.vipDiscountAmount > 0" class="totals__discount">
      <dt>Remise VIP</dt>
      <dd>− {{ formatEuros(summary.vipDiscountAmount) }}</dd>
    </div>
    <div v-if="summary.shipping.breakdown.length > 0" class="totals__shipping">
      <dt>Livraison HT</dt>
      <dd>{{ summary.shipping.totalHt > 0 ? formatEuros(summary.shipping.totalHt) : "Offerte" }}</dd>
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
    <div>
      <dt>TVA</dt>
      <dd>{{ formatEuros(summary.vatAmount) }}</dd>
    </div>
    <div class="totals__total">
      <dt>Total TTC</dt>
      <dd>{{ formatEuros(summary.totalTtc) }}</dd>
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
.totals__total {
  border-top: 1px solid var(--ink-line);
  margin-top: 0.4rem;
  padding-top: 0.8rem !important;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
}
</style>
