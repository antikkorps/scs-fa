import { hash } from "@node-rs/argon2"

const ARGON2ID_OPTIONS = {
  memoryCost: 19_456, // 19 MiB — OWASP 2024 minimum for argon2id
  timeCost: 2,
  parallelism: 1,
}

/** The one way a password is stored: argon2id, OWASP parameters. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS)
}
