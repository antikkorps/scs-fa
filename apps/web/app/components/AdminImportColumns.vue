<script setup lang="ts">
/**
 * Every column the catalogue import reads, and how to fill it (story 12.16d):
 * Fred did not know the file could carry the categories and the tags.
 */
import { CATALOG_IMPORT_COLUMNS } from "@armurier/shared"
import { IMPORT_COLUMN_HINTS } from "~/utils/import-column-hints"
</script>

<template>
  <details class="columns">
    <summary>Colonnes du fichier et comment les remplir</summary>
    <div class="columns__scroll">
      <table class="columns__table">
      <thead>
        <tr>
          <th scope="col">Colonne</th>
          <th scope="col"><span class="sr-only">Obligatoire</span></th>
          <th scope="col">Contenu</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="column in CATALOG_IMPORT_COLUMNS" :key="column.key">
          <th scope="row">{{ column.header }}</th>
          <td class="columns__required">{{ column.required ? "Obligatoire" : "" }}</td>
          <td>{{ IMPORT_COLUMN_HINTS[column.key] }}</td>
        </tr>
      </tbody>
      </table>
    </div>
  </details>
</template>

<style scoped>
.columns {
  margin-top: 1rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.columns summary {
  cursor: pointer;
  color: var(--brass);
}
.columns__scroll {
  overflow-x: auto;
}
.columns__table {
  width: 100%;
  margin-top: 0.75rem;
  border-collapse: collapse;
}
.columns__table th,
.columns__table td {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--ink-line);
  text-align: left;
  vertical-align: top;
}
.columns__table thead th {
  color: var(--paper-faint);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: var(--ls-eyebrow);
}
.columns__table tbody th {
  color: var(--paper);
  font-weight: 500;
  white-space: nowrap;
}
.columns__required {
  color: var(--brass);
  white-space: nowrap;
}
</style>
