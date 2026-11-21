import { describe, expect, it } from "vitest"
import { SIGNATURES } from "./signatures"

describe("SIGNATURES", () => {
  it("lists the collection, then Gun Art, each leading to its own section", () => {
    expect(SIGNATURES.map((signature) => [signature.key, signature.to])).toEqual([
      ["collection", "/armes-de-collection"],
      ["gunart", "/collection"],
    ])
  })

  it("gives each a pitch and two ways in, so both panels behave alike", () => {
    for (const signature of SIGNATURES) {
      expect(signature.lede.length).toBeGreaterThan(0)
      expect(signature.ctas).toHaveLength(2)
    }
  })

  it("leads Gun Art to the artist before the gallery", () => {
    const gunArt = SIGNATURES.find((signature) => signature.key === "gunart")
    expect(gunArt?.ctas.map((cta) => cta.to)).toEqual(["/collection/artiste", "/collection"])
  })
})
