/** A `tel:` link from a phone number as typed: French numbers dial as +33. */
export function telHref(phone: string): string {
  const international = phone.trim().startsWith("+")
  // "(0)" is the trunk prefix written next to a country code: not dialled.
  const digits = phone.replace(/\(0\)/g, "").replace(/\D/g, "")
  if (international) return `tel:+${digits}`
  return `tel:${digits.startsWith("0") ? `+33${digits.slice(1)}` : digits}`
}
