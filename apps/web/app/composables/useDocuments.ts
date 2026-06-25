import type { LegalDocument, LegalDocumentMeta, OrderLegal } from "~/types/account"

// Legal-document operations for the account area (API 4.1 + 4.3): the user's
// document library, multipart uploads, and the per-order legal checklist.
export function useDocuments() {
  const api = useApi()

  function list(): Promise<LegalDocument[]> {
    return api<{ data: LegalDocument[] }>("/legal-documents").then((r) => r.data)
  }

  function get(id: string): Promise<LegalDocument> {
    return api<{ data: LegalDocument }>(`/legal-documents/${id}`).then((r) => r.data)
  }

  // Multipart upload. The bearer token is attached by useApi; we must NOT set a
  // Content-Type header ourselves — the browser adds the multipart boundary.
  function upload(file: File, meta: LegalDocumentMeta): Promise<LegalDocument> {
    const form = new FormData()
    form.append("docType", meta.docType)
    if (meta.docNumber) form.append("docNumber", meta.docNumber)
    if (meta.issuedAt) form.append("issuedAt", meta.issuedAt)
    if (meta.expiresAt) form.append("expiresAt", meta.expiresAt)
    form.append("file", file)
    return api<{ data: LegalDocument }>("/legal-documents", { method: "POST", body: form }).then((r) => r.data)
  }

  function remove(id: string): Promise<void> {
    return api<void>(`/legal-documents/${id}`, { method: "DELETE" })
  }

  // The order's legal checklist: which doc types are required and where each stands.
  function orderLegal(orderId: string): Promise<OrderLegal> {
    return api<{ data: OrderLegal }>(`/orders/${orderId}/legal`).then((r) => r.data)
  }

  return { list, get, upload, remove, orderLegal }
}
