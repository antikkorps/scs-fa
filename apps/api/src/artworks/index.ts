import type { FastifyPluginAsync } from "fastify"
import { artworkEditorialRoutes } from "./editorial.js"
import { getArtworkRoute, listArtworksRoute } from "./public.js"

export const artworkRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listArtworksRoute)
  // Registered BEFORE the `:slug` route so `series` and `themes` stay static.
  await fastify.register(artworkEditorialRoutes)
  await fastify.register(getArtworkRoute)
}
