import type { FastifyPluginAsync } from "fastify"
import { forgotPasswordRoute } from "./forgot-password.js"
import { loginRoute } from "./login.js"
import { loginCodeRoutes } from "./login-code.js"
import { logoutRoute } from "./logout.js"
import { profileRoute } from "./profile.js"
import { refreshRoute } from "./refresh.js"
import { registerRoute } from "./register.js"
import { resetPasswordRoute } from "./reset-password.js"
import { totpRoutes } from "./totp-routes.js"

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(registerRoute)
  await fastify.register(loginRoute)
  await fastify.register(loginCodeRoutes)
  await fastify.register(refreshRoute)
  await fastify.register(logoutRoute)
  await fastify.register(profileRoute)
  await fastify.register(forgotPasswordRoute)
  await fastify.register(resetPasswordRoute)
  await fastify.register(totpRoutes, { prefix: "/totp" })
}
