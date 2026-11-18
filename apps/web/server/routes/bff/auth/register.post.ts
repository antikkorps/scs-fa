// BFF register: forwards the sign-up and nothing more. No login afterwards: the
// API answers the same whether the address was free or taken (no enumeration),
// so a session opened here would give away which case it was.
export default defineEventHandler(async (event) =>
  callAuthApi<{ message: string }>(event, "/auth/register", await readBody(event)),
)
