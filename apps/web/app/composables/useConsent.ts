import { CONSENT_MAX_AGE_SECONDS, type ConsentChoice, parseConsent, serializeConsent } from "~/utils/consent"

/**
 * The visitor's choice about audience measurement (story 9.6).
 *
 * Read from a cookie rather than localStorage so the server knows it too: a
 * visitor who has already answered never sees the banner flash in on load.
 */
export function useConsent() {
  const cookie = useCookie<string | null>("scs_consent", {
    maxAge: CONSENT_MAX_AGE_SECONDS,
    sameSite: "lax",
    path: "/",
    secure: !import.meta.dev,
    // Serialised by hand: the default JSON encoding would quote the value.
    encode: (v) => v ?? "",
    decode: (v) => v ?? null,
  })
  // Shared state, persisted by the cookie. Each useCookie() call is its own ref
  // and does not see another instance's writes: the banner accepting would
  // never reach the analytics plugin. One useState is what everyone reads.
  const stored = useState<string | null>("consent-value", () => cookie.value ?? null)
  // The banner can be reopened from the footer after a choice was made.
  const reopened = useState("consent-reopened", () => false)

  const choice = computed(() => parseConsent(stored.value))
  const analyticsAllowed = computed(() => choice.value === "granted")
  const bannerVisible = computed(() => choice.value === null || reopened.value)

  function decide(next: ConsentChoice) {
    const value = serializeConsent(next)
    cookie.value = value
    stored.value = value
    reopened.value = false
  }

  return {
    choice,
    analyticsAllowed,
    bannerVisible,
    accept: () => decide("granted"),
    refuse: () => decide("denied"),
    reopen: () => {
      reopened.value = true
    },
  }
}
