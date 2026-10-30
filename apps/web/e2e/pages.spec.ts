import { E2E_FIXTURES } from "@armurier/shared"
import { expect, test } from "@playwright/test"
import { API_ORIGIN, WEB_ORIGIN } from "../playwright.config"
import { brokenImages, horizontalOverflow, landmarkProblems, smallText } from "./layout-rules"

// Every public page, at every width of the config's projects, must break none
// of the layout rules — and log no error while doing it.

const PAGES: { path: string; status?: number }[] = [
  { path: "/" },
  { path: "/boutique" },
  { path: `/boutique/categorie/${E2E_FIXTURES.category}` },
  { path: `/boutique/tag/${E2E_FIXTURES.tag}` },
  { path: `/boutique/${E2E_FIXTURES.product}` },
  { path: "/collection" },
  { path: `/collection/${E2E_FIXTURES.artwork}` },
  { path: `/collection/artiste/${E2E_FIXTURES.artist}` },
  { path: `/collection/serie/${E2E_FIXTURES.series}` },
  { path: `/collection/theme/${E2E_FIXTURES.theme}` },
  { path: "/armes-de-collection" },
  { path: "/blog" },
  { path: `/blog/${E2E_FIXTURES.post}` },
  { path: "/recherche?q=carabine" },
  { path: "/panier" },
  { path: "/connexion" },
  { path: "/inscription" },
  { path: "/mot-de-passe-oublie" },
  { path: "/pro/inscription" },
  { path: "/cgv" },
  { path: "/mentions-legales" },
  { path: "/confidentialite" },
  { path: "/reglementation" },
  { path: "/cette-page-n-existe-pas", status: 404 },
]

test.beforeEach(async ({ context }) => {
  // Production serves the site and the API on one origin (Caddy routes /api);
  // here they are two servers, so the browser's /api requests are forwarded.
  await context.route(
    (url) => url.origin === WEB_ORIGIN && url.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url())
      // Fetched then fulfilled — not `continue({ url })` — so the browser sees
      // the response come from the site's origin, as behind Caddy; otherwise
      // the API's `Cross-Origin-Resource-Policy: same-origin` blocks it.
      const response = await route.fetch({ url: `${API_ORIGIN}${url.pathname}${url.search}` })
      await route.fulfill({ response })
    },
  )
})

for (const { path, status = 200 } of PAGES) {
  test(path, async ({ page }) => {
    const errors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`)
    })
    page.on("pageerror", (error) => errors.push(`exception: ${error.message}`))

    const response = await page.goto(path, { waitUntil: "networkidle" })
    expect(response?.status(), "HTTP status").toBe(status)

    const problems = {
      overflow: await horizontalOverflow(page),
      smallText: await smallText(page),
      landmarks: await landmarkProblems(page),
      brokenImages: await brokenImages(page),
      // A 404 page logs its own 404 document load; nothing else is expected.
      console: errors.filter((error) => !(status === 404 && error.includes("404"))),
    }
    expect(problems).toEqual({ overflow: [], smallText: [], landmarks: [], brokenImages: [], console: [] })
  })
}
