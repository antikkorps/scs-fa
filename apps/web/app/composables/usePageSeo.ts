import type { MaybeRefOrGetter } from "vue"

export interface PageSeo {
  /** The page's own title; the site name is appended by the title template. "" on the home page. */
  title: MaybeRefOrGetter<string>
  /** Title on social cards. Defaults to "<title> — SCS Firearm". */
  socialTitle?: MaybeRefOrGetter<string>
  description: MaybeRefOrGetter<string>
  /** Path of the page's canonical URL, e.g. "/boutique/glock-17". */
  path: MaybeRefOrGetter<string>
  /** False when the page states its own canonical (a paginated catalogue does). */
  canonical?: boolean
  /** The page's own image, as stored — relative or absolute. The brand card otherwise. */
  image?: MaybeRefOrGetter<string | null | undefined>
  imageAlt?: MaybeRefOrGetter<string | null | undefined>
  /** `article` for journal posts, `profile` for an artist, `website` for everything else. */
  type?: "website" | "article" | "profile"
  noindex?: boolean
}

const DEFAULT_IMAGE = { path: "/og-default.png", width: 1200, height: 630, alt: "SCS Firearm — Armurerie & Gun Art" }

/**
 * Everything a page tells search engines and social networks about itself, in
 * one call (story 9.6).
 *
 * Each page used to write its own subset: the audit found no `og:image` on 54
 * of 57 pages (a shared link showed no picture), no `twitter:*` tag anywhere,
 * canonicals missing on some pages and descriptions from 24 to 214 characters.
 * Here the social tags always mirror the page's own, the description is bounded,
 * and a page without an image of its own falls back to the brand card rather
 * than to nothing.
 */
export function usePageSeo(seo: PageSeo) {
  const siteUrl = useRuntimeConfig().public.siteUrl as string

  const title = () => toValue(seo.title)
  const socialTitle = () => toValue(seo.socialTitle) || (title() ? `${title()} — SCS Firearm` : "SCS Firearm")
  const description = () => metaDescription(toValue(seo.description))
  const url = () => `${siteUrl}${toValue(seo.path)}`
  const ownImage = () => ogImageUrl(toValue(seo.image), siteUrl)
  const image = () => ownImage() ?? `${siteUrl}${DEFAULT_IMAGE.path}`
  const imageAlt = () => (ownImage() ? toValue(seo.imageAlt) || title() || DEFAULT_IMAGE.alt : DEFAULT_IMAGE.alt)
  // Dimensions are known for the brand card only; stating wrong ones is worse than none.
  const imageWidth = () => (ownImage() ? undefined : DEFAULT_IMAGE.width)
  const imageHeight = () => (ownImage() ? undefined : DEFAULT_IMAGE.height)

  useSeoMeta({
    title,
    description,
    ogTitle: socialTitle,
    ogDescription: description,
    ogUrl: url,
    ogType: seo.type ?? "website",
    ogImage: image,
    ogImageAlt: imageAlt,
    ogImageWidth: imageWidth,
    ogImageHeight: imageHeight,
    twitterTitle: socialTitle,
    twitterDescription: description,
    twitterImage: image,
    twitterImageAlt: imageAlt,
    ...(seo.noindex ? { robots: "noindex, follow" } : {}),
  })

  if (seo.canonical !== false && !seo.noindex) {
    useHead({ link: [{ key: "canonical", rel: "canonical", href: url }] })
  }
}
