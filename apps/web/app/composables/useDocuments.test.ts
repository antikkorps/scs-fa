// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useDocuments } from "./useDocuments"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

mockNuxtImport("useApi", () => () => apiMock)

beforeEach(() => {
  apiMock.mockReset()
})

describe("useDocuments", () => {
  it("lists the user's documents", async () => {
    apiMock.mockResolvedValue({ data: [{ id: "d1", docType: "cni" }] })
    const docs = useDocuments()
    const res = await docs.list()
    expect(apiMock).toHaveBeenCalledWith("/legal-documents")
    expect(res).toHaveLength(1)
  })

  it("fetches a single document (with its download URL)", async () => {
    apiMock.mockResolvedValue({ data: { id: "d1", downloadUrl: "https://x/y" } })
    const docs = useDocuments()
    const res = await docs.get("d1")
    expect(apiMock).toHaveBeenCalledWith("/legal-documents/d1")
    expect(res.downloadUrl).toBe("https://x/y")
  })

  it("uploads a multipart form with the file and metadata, without a Content-Type header", async () => {
    apiMock.mockResolvedValue({ data: { id: "d2", docType: "permis_chasse" } })
    const docs = useDocuments()
    const file = new File([new Uint8Array([1, 2, 3])], "permis.pdf", { type: "application/pdf" })
    await docs.upload(file, { docType: "permis_chasse", docNumber: "ABC123", expiresAt: "2030-01-01" })

    expect(apiMock).toHaveBeenCalledTimes(1)
    const [url, opts] = (apiMock.mock.calls[0] ?? []) as [string, { method: string; body: FormData; headers?: unknown }]
    expect(url).toBe("/legal-documents")
    expect(opts.method).toBe("POST")
    const body = opts.body
    expect(body).toBeInstanceOf(FormData)
    expect(body.get("docType")).toBe("permis_chasse")
    expect(body.get("docNumber")).toBe("ABC123")
    expect(body.get("expiresAt")).toBe("2030-01-01")
    expect(body.get("file")).toBeInstanceOf(File)
    // Never set Content-Type: the browser must add the multipart boundary.
    expect(opts.headers).toBeUndefined()
  })

  it("omits optional metadata that is not provided", async () => {
    apiMock.mockResolvedValue({ data: { id: "d3" } })
    const docs = useDocuments()
    const file = new File([new Uint8Array([1])], "cni.pdf", { type: "application/pdf" })
    await docs.upload(file, { docType: "cni" })
    const [, opts] = (apiMock.mock.calls[0] ?? []) as [string, { body: FormData }]
    const body = opts.body
    expect(body.get("docNumber")).toBeNull()
    expect(body.get("issuedAt")).toBeNull()
    expect(body.get("expiresAt")).toBeNull()
  })

  it("deletes a document", async () => {
    apiMock.mockResolvedValue(undefined)
    const docs = useDocuments()
    await docs.remove("d1")
    expect(apiMock).toHaveBeenCalledWith("/legal-documents/d1", { method: "DELETE" })
  })

  it("fetches the order legal checklist", async () => {
    apiMock.mockResolvedValue({ data: { orderId: "o1", requiresVerification: true, requiredDocs: [] } })
    const docs = useDocuments()
    const res = await docs.orderLegal("o1")
    expect(apiMock).toHaveBeenCalledWith("/orders/o1/legal")
    expect(res.requiresVerification).toBe(true)
  })
})
