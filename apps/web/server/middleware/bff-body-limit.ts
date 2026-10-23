import { bffBodyRefusal } from "../utils/bodyLimit"

// Bounds the request bodies the BFF buffers before forwarding (story 12.9f).
const STATUS_MESSAGES = {
  400: "Invalid Content-Length",
  411: "Content-Length required",
  413: "Request body too large",
} as const

export default defineEventHandler((event) => {
  const refusal = bffBodyRefusal(event.path, {
    contentLength: getRequestHeader(event, "content-length"),
    transferEncoding: getRequestHeader(event, "transfer-encoding"),
  })
  if (refusal !== null) throw createError({ statusCode: refusal, statusMessage: STATUS_MESSAGES[refusal] })
})
