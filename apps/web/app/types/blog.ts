export interface BlogListItem {
  id: string
  slug: string
  title: string
  excerpt: string | null
  category: string | null
  tags: string | null
  featuredImageUrl: string | null
  featured: boolean | null
  publishedAt: string | null
  authorName: string | null
}

export interface BlogArticleDetail {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  category: string | null
  tags: string | null
  featuredImageUrl: string | null
  metaTitle: string | null
  metaDescription: string | null
  publishedAt: string | null
  updatedAt: string | null
  authorName: string | null
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface BlogListResponse {
  data: BlogListItem[]
  pagination: Pagination
}
