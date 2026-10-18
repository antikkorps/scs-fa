import {
  createClientErrorReporter,
  reportClientError,
  sendClientErrorReport,
  setClientErrorReporter,
} from "~/utils/clientErrors"

// Story 12.7d — catch what breaks in the browser on the cart, checkout and
// payment pages (the reporter ignores every other page) and send it to the API.
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  setClientErrorReporter(
    createClientErrorReporter({ path: () => router.currentRoute.value.fullPath, send: sendClientErrorReport }),
  )

  window.addEventListener("error", (event) => reportClientError("error", event.error ?? event.message))
  window.addEventListener("unhandledrejection", (event) => reportClientError("unhandledrejection", event.reason))
  nuxtApp.hook("vue:error", (error) => reportClientError("vue", error))
})
