import type { NewsletterSegment } from "@armurier/shared"
import type { NewsletterService, SyncContactParams } from "./types.js"

// In-process driver for tests, CI and local development — no API key, no network.
// State is per-instance so suites stay isolated.
export class InMemoryNewsletterService implements NewsletterService {
  private readonly contacts = new Map<string, NewsletterSegment[]>()

  async syncContact(params: SyncContactParams): Promise<void> {
    this.contacts.set(params.email.toLowerCase(), [...params.segments])
  }

  async deleteContact(email: string): Promise<void> {
    this.contacts.delete(email.toLowerCase())
  }

  // Test-only helpers: assert on what was pushed to the provider.
  segmentsOf(email: string): NewsletterSegment[] | undefined {
    return this.contacts.get(email.toLowerCase())
  }

  clear(): void {
    this.contacts.clear()
  }
}
