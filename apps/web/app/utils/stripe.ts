/** A Stripe test-mode publishable key: the test-card hint shows with it, never with a live one. */
export function isStripeTestKey(publishableKey: string): boolean {
  return publishableKey.startsWith("pk_test_")
}
