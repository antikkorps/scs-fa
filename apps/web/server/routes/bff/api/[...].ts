// BFF API proxy. Authenticated calls from the browser go to /bff/api/* (same
// origin) instead of straight to the API, so the access token can live in an
// httpOnly cookie the browser JS never sees. This handler reads that cookie,
// attaches the bearer server-side, and forwards to the upstream API. On a 401 it
// rotates the session once (refreshSession) and retries. The request body is
// buffered and forwarded as-is, so JSON and multipart uploads both pass through.
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "_") ?? ""
  const apiBase = useRuntimeConfig(event).public.apiBase as string
  const target = `${apiBase}/${slug}`

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
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(contentType ? { "content-type": contentType } : {}),
      },
      // Forward upstream 4xx/5xx to the client instead of throwing here, so page
      // code still sees the real status + error payload.
      ignoreResponseError: true,
    })

  let res = await call(readAccessCookie(event))
  if (res.status === 401) {
    const rotated = await refreshSession(event)
    if (rotated) res = await call(rotated)
  }

  setResponseStatus(event, res.status)
  const respType = res.headers.get("content-type")
  if (respType) setResponseHeader(event, "content-type", respType)
  return res._data
})
