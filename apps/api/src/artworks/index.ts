import type { FastifyPluginAsync } from "fastify"
import { getArtworkRoute, listArtworksRoute } from "./public.js"

export const artworkRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listArtworksRoute)
  await fastify.register(getArtworkRoute)
}
