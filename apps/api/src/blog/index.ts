import type { FastifyPluginAsync } from "fastify"
import { getBlogPostRoute, listBlogRoute } from "./public.js"

export const blogRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listBlogRoute)
  await fastify.register(getBlogPostRoute)
}
