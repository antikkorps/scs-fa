// BFF API proxy. Authenticated calls from the browser go to /bff/api/* (same
// origin) instead of straight to the API, so the access token can live in an
// httpOnly cookie the browser JS never sees. This handler reads that cookie,
// attaches the bearer server-side, and forwards to the upstream API. On a 401 it
// rotates the session once (refreshSession) and retries. Bodies pass through
// as bytes both ways: JSON, multipart uploads and file downloads alike.
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "_") ?? ""
  const upstream = apiUpstream(event)
  const target = `${upstream.base}/${slug}`

  const method = event.method
  const query = getQuery(event)
  const contentType = getRequestHeader(event, "content-type")
  const body = method === "GET" || method === "HEAD" ? undefined : await readRawBody(event, false)

  const call = (token: string | undefined) =>
    $fetch.raw(target, {
      method,
      query,
      body,
      headers: {
        ...upstream.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(contentType ? { "content-type": contentType } : {}),
      },
      // Forward upstream 4xx/5xx to the client instead of throwing here, so page
      // code still sees the real status + error payload.
      ignoreResponseError: true,
      // Never decoded here: a workbook would not survive a round trip through text.
      responseType: "arrayBuffer",
    })

  let res = await call(readAccessCookie(event))
  if (res.status === 401) {
    const rotated = await refreshSession(event)
    if (rotated) res = await call(rotated)
  }

  setResponseStatus(event, res.status)
  for (const [name, value] of forwardedResponseHeaders(res.headers)) setResponseHeader(event, name, value)
  const bytes = res._data as ArrayBuffer | undefined
  return bytes && bytes.byteLength > 0 ? Buffer.from(bytes) : null
})
