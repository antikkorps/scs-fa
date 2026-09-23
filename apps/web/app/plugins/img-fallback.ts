/**
 * `v-img-fallback="<placeholder src>"` — swap a broken image for its placeholder.
 *
 * Why a directive rather than a handler per component: every image on the site
 * already funnels through `artworkImage()`, but it is rendered by six different
 * call sites, some as a plain <img> and some through <ProtectedImage>. A
 * directive covers both with one implementation — on a single-root component it
 * falls through to the root element, which is the <img> itself.
 *
 * The state this exists for: an artwork whose `featuredImageUrl` is stored but
 * whose object the storage cannot serve — deleted, credentials rotated,
 * provider down. Before this, the browser dumped the alt text across the grid
 * while the pieces with no image at all rendered a clean placeholder. Both are
 * "no visual to show", so both land on the same placeholder.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive<HTMLImageElement, string>("img-fallback", {
    mounted(el, binding) {
      const fallback = binding.value
      if (!fallback) return

      const swap = () => {
        // Guard against a loop: if the placeholder itself somehow fails, let it
        // fail rather than reassigning the same src forever. It is an inline
        // data URI, so it cannot actually miss — but the guard is what makes
        // that assumption safe to hold.
        el.removeEventListener("error", swap)
        if (el.src !== fallback) el.src = fallback
      }

      el.addEventListener("error", swap)

      // The error may already have fired: SSR markup is hydrated after the
      // browser has started (and possibly finished) fetching the image, so a
      // listener attached at mount can miss it entirely.
      //
      // "Finished, attempted, and has no pixels" is the signal. `currentSrc` is
      // what makes it safe — it is only populated once the browser has actually
      // selected a source to fetch, so an image that has not started yet cannot
      // be mistaken for one that failed.
      if (el.complete && el.currentSrc && el.naturalWidth === 0) swap()
    },
  })
})
