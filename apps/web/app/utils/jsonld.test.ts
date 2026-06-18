import { describe, expect, it } from "vitest"
import { serializeJsonLd } from "./jsonld"

describe("serializeJsonLd", () => {
  it("escapes < > & so a payload cannot break out of the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" })
    expect(out).not.toContain("</script>")
    expect(out).not.toContain("<")
    expect(out).not.toContain(">")
    expect(out).toContain("\\u003c")
    expect(out).toContain("\\u003e")
  })

  it("stays valid JSON that round-trips to the original value", () => {
    const value = { name: "A & B </script>", nested: { x: 1 } }
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value)
  })
})
