// Pagination block returned by every paginated API list endpoint.
// Single definition: Nuxt auto-imports types from this folder, so a second
// `Pagination` export elsewhere makes `nuxt prepare` warn about duplicates.
export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}
