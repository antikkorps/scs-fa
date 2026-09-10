<script setup lang="ts">
import type { AdminProfitability } from "~/types/admin-finance"
import { formatEuros } from "~/utils/format"

/**
 * Cost, charges, third-party share and margin for one article (story 11.10).
 *
 * The share is part of the sum on purpose: a margin that ignored what is owed to
 * the artist or the advisor would read as profit and would not be.
 */
defineProps<{
  profitability: AdminProfitability | null
  /** Name of whoever is owed a share, when there is one. */
  beneficiaryName?: string | null
}>()
</script>

<template>
  <div v-if="profitability" class="prof" :class="{ 'prof--loss': profitability.marginHt < 0 }">
    <dl class="prof__rows">
      <div>
        <dt>Prix de vente HT</dt>
        <dd>{{ formatEuros(profitability.priceHt) }}</dd>
      </div>
      <div>
        <dt>− Prix d'achat</dt>
        <dd>
          {{ formatEuros(profitability.costPriceHt) }}
          <span v-if="profitability.costUnknown" class="warn">non renseigné</span>
        </dd>
      </div>
      <div>
        <dt>− Charges</dt>
        <dd>{{ formatEuros(profitability.chargesHt) }}</dd>
      </div>
      <div>
        <dt>− Reversement<span v-if="beneficiaryName"> ({{ beneficiaryName }})</span></dt>
        <dd>{{ formatEuros(profitability.payoutHt) }}</dd>
      </div>
      <div class="prof__total">
        <dt>= Marge</dt>
        <dd>{{ formatEuros(profitability.marginHt) }} <span>({{ profitability.marginPct }} %)</span></dd>
      </div>
    </dl>

    <p v-if="profitability.costUnknown" class="prof__note">
      ⚠️ Sans prix d'achat, cette marge est un <strong>plafond</strong>, pas un résultat.
    </p>
    <p v-if="profitability.basedOnPriceHt !== undefined" class="prof__note">
      Calculée sur le tirage le plus cher de l'édition ({{ formatEuros(profitability.basedOnPriceHt) }} HT) — les
      tirages suivants rapportent moins.
    </p>
  </div>
</template>

<style scoped>
.prof {
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-left-width: 3px;
  border-left-color: var(--brass);
  border-radius: var(--radius);
  padding: 1rem 1.2rem;
}
.prof--loss {
  border-left-color: var(--danger);
}
.prof__rows {
  margin: 0;
  display: grid;
  gap: 0.35rem;
}
.prof__rows > div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.88rem;
}
.prof__rows dt {
  color: var(--paper-dim);
}
.prof__rows dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.prof__total {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--ink-line);
  font-weight: 600;
}
.prof__total dd {
  color: var(--brass);
}
.prof--loss .prof__total dd {
  color: var(--danger);
}
.prof__total span {
  color: var(--paper-faint);
  font-weight: 400;
  font-size: 0.85rem;
}
.warn {
  color: var(--danger);
  font-size: 0.78rem;
  margin-left: 0.4rem;
}
.prof__note {
  margin: 0.8rem 0 0;
  font-size: 0.78rem;
  color: var(--paper-faint);
  line-height: 1.5;
}
.prof__note strong {
  color: var(--paper-dim);
}
</style>
