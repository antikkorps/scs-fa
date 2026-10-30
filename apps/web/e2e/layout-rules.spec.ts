import { expect, test } from "@playwright/test"
import { brokenImages, horizontalOverflow, landmarkProblems, smallText } from "./layout-rules"

// The rules themselves, proven on hand-built pages: each one must catch its
// defect and stay quiet on a sound page — a rule that never fires guards nothing.

const SOUND_PAGE = `
  <header><nav>Menu</nav></header>
  <main><h1>Titre</h1><p style="font-size:16px">Texte lisible</p></main>
  <footer>Pied de page</footer>`

test.describe("layout rules", () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test("a sound page breaks no rule", async ({ page }) => {
    await page.setContent(SOUND_PAGE)
    expect(await horizontalOverflow(page)).toEqual([])
    expect(await smallText(page)).toEqual([])
    expect(await landmarkProblems(page)).toEqual([])
    expect(await brokenImages(page)).toEqual([])
  })

  test("catches horizontal overflow and names the culprit", async ({ page }) => {
    await page.setContent(`${SOUND_PAGE}<div class="trop-large" style="width:600px">x</div>`)
    const found = await horizontalOverflow(page)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("trop-large")
  })

  test("ignores what overflows inside its own scroll container", async ({ page }) => {
    await page.setContent(
      `${SOUND_PAGE}<div style="overflow-x:auto"><table style="width:900px"><tr><td>x</td></tr></table></div>`,
    )
    expect(await horizontalOverflow(page)).toEqual([])
  })

  test("catches visible text under 12px, not screen-reader-only text", async ({ page }) => {
    await page.setContent(`${SOUND_PAGE}
      <p class="minuscule" style="font-size:11px">Trop petit</p>
      <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);font-size:10px">Lecteur d'écran</span>
      <p style="display:none;font-size:8px">Caché</p>`)
    const found = await smallText(page)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("minuscule")
    expect(found[0]).toContain("11px")
  })

  test("demands one h1 and a header, main and footer", async ({ page }) => {
    await page.setContent("<main><h1>Un</h1><h1>Deux</h1></main>")
    const found = await landmarkProblems(page)
    expect(found).toContain("2 <h1> (exactly one expected)")
    expect(found).toContain("no visible <header>")
    expect(found).toContain("no visible <footer>")
  })

  test("catches an image that failed to load, and loads lazy ones first", async ({ page }) => {
    await page.setContent(`${SOUND_PAGE}
      <img class="cassee" alt="" src="data:image/png;base64,invalide" width="50" height="50">
      <div style="height:3000px"></div>
      <img alt="" loading="lazy" width="10" height="10"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/%3E">`)
    const found = await brokenImages(page)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("cassee")
  })
})
