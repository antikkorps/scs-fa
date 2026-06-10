export interface ArtworkListItem {
  id: string
  slug: string
  title: string
  artistName: string | null
  description: string | null
  featuredImageUrl: string | null
  editionLimit: number
  editionYear: number | null
  availableCount: number
  soldCount: number
  priceFromHt: number | null
  priceFromTtc: number | null
}

export interface ArtworkFormat {
  id: string
  name: string
  widthCm: number
  heightCm: number
  priceFactor: number
}

export interface ArtworkPrint {
  id: string
  printNumber: number
  printDesignation: string
  formatId: string
  status: "available" | "in_cart" | "sold" | "reserved" | "cancelled"
  priceHt: number
  priceTtc: number
}

export interface ArtworkDetail {
  id: string
  slug: string
  title: string
  description: string | null
  longDescription: string | null
  artistName: string | null
  artistBio: string | null
  featuredImageUrl: string | null
  editionLimit: number
  editionYear: number | null
  availableFormats: ArtworkFormat[] | null
  vatPct: number
  includeCertificate: boolean | null
  prints: ArtworkPrint[]
  availableCount: number
  soldCount: number
  priceFromHt: number | null
  priceFromTtc: number | null
}
