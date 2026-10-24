import { linkTokenFromHash } from "~/utils/linkToken"

/**
 * The single-use token of a mailed link, read from the URL fragment (story
 * 12.9g, see utils/linkToken). The fragment never reaches the server, so the
 * token is only known once mounted: `null` until then, "" when the link has
 * none. Once read, it leaves the address bar, so it is not kept in the history
 * or carried into a copied URL.
 */
export function useLinkToken() {
  const route = useRoute()
  const token = ref<string | null>(null)

  onMounted(() => {
    token.value = linkTokenFromHash(route.hash)
    if (token.value) history.replaceState(history.state, "", `${route.path}${window.location.search}`)
  })

  return token
}
