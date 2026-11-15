// The SCS receiving account printed on the RIB handed to a customer who pays
// by bank transfer (story 6.2). Optional: the shop can open before the bank
// details are known, card payments work without them, and an order that needs
// a transfer is refused until they are set (insertPaymentBuckets).
//
// Kept in the environment rather than the back-office on purpose: swapping the
// IBAN is the classic way to divert transfers, so changing it takes server
// access, not just an admin session.

export interface BankDetails {
  iban: string
  bic: string
  bankName: string
  accountHolder: string
}

const BANK_DETAIL_VARIABLES = [
  "VIREMENT_IBAN",
  "VIREMENT_BIC",
  "VIREMENT_BANK_NAME",
  "VIREMENT_ACCOUNT_HOLDER",
] as const

type BankDetailVariable = (typeof BANK_DETAIL_VARIABLES)[number]
type Environment = Partial<Record<BankDetailVariable, string>>

// A blank value (`VIREMENT_BIC=" "`) would print an empty field on the RIB.
function bankValue(environment: Environment, name: BankDetailVariable): string | null {
  return environment[name]?.trim() || null
}

/**
 * The variables a half-filled configuration lacks. All four or none: a RIB
 * missing its BIC or holder would print incomplete instructions to customers.
 */
export function missingBankDetails(environment: Environment): string[] {
  const missing = BANK_DETAIL_VARIABLES.filter((name) => !bankValue(environment, name))
  return missing.length === BANK_DETAIL_VARIABLES.length ? [] : missing
}

/** The receiving account, or null while the bank details are not configured. */
export function bankDetailsFrom(environment: Environment): BankDetails | null {
  const iban = bankValue(environment, "VIREMENT_IBAN")
  const bic = bankValue(environment, "VIREMENT_BIC")
  const bankName = bankValue(environment, "VIREMENT_BANK_NAME")
  const accountHolder = bankValue(environment, "VIREMENT_ACCOUNT_HOLDER")
  if (!iban || !bic || !bankName || !accountHolder) return null
  return { iban, bic, bankName, accountHolder }
}
