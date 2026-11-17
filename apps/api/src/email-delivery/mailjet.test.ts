import { describe, expect, it } from "vitest"
import { mailjetDelivery } from "./mailjet.js"

const TRACKING_ID = "5f0c6b1e-6c1a-4c1e-9f3a-2b7d8e9f0a1b"

// Shapes from Mailjet's Event API: one object per call (version 1) or an array (grouped, version 2).
const event = (fields: Record<string, unknown>) => ({
  time: 1_760_788_800,
  MessageID: 1234567890,
  Message_GUID: "1ab23cd4-e567-8901-2f34-5gh6ij7kl8m9",
  email: "jean@example.fr",
  mj_campaign_id: 0,
  mj_contact_id: 42,
  customcampaign: "",
  CustomID: TRACKING_ID,
  Payload: "",
  ...fields,
})

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`

describe("Mailjet delivery adapter", () => {
  it("asks Mailjet to echo our id through X-MJ-CustomID", () => {
    expect(mailjetDelivery.trackingHeaders(TRACKING_ID)).toEqual({ "X-MJ-CustomID": TRACKING_ID })
  })

  it("reads the shared secret from the password of the Basic auth Mailjet sends", () => {
    expect(mailjetDelivery.presentedSecret(basic("mailjet", "s3cret:with-colon"))).toBe("s3cret:with-colon")
  })

  it("finds no secret without Basic credentials", () => {
    for (const header of [undefined, "", "Bearer s3cret", "Basic", "Basic !!!not-base64", basic("only-user", "")]) {
      expect(mailjetDelivery.presentedSecret(header), String(header)).toBeNull()
    }
  })

  it("translates sent, hard bounce, blocked and spam into our outcomes", () => {
    const reports = mailjetDelivery.parseReports([
      event({ event: "sent", smtp_reply: "250 2.0.0 OK" }),
      event({
        event: "bounce",
        hard_bounce: true,
        blocked: false,
        error_related_to: "recipient",
        error: "user unknown",
      }),
      event({ event: "blocked", error_related_to: "recipient", error: "preblocked" }),
      event({ event: "spam", source: "JMRPP" }),
    ])
    expect(reports?.map((report) => report.outcome)).toEqual(["delivered", "hard_bounce", "blocked", "spam"])
    expect(reports?.every((report) => report.trackingId === TRACKING_ID)).toBe(true)
  })

  it("accepts a single event, as Mailjet sends them ungrouped", () => {
    expect(mailjetDelivery.parseReports(event({ event: "spam" }))).toEqual([
      { trackingId: TRACKING_ID, outcome: "spam" },
    ])
  })

  it("leaves out soft bounces, engagement and e-mails that carry no id of ours", () => {
    const reports = mailjetDelivery.parseReports([
      event({ event: "bounce", hard_bounce: false }),
      event({ event: "open" }),
      event({ event: "click" }),
      event({ event: "unsub" }),
      // A newsletter sent from Mailjet's own campaign editor
      event({ event: "spam", CustomID: "" }),
    ])
    expect(reports).toEqual([])
  })

  it("keeps the good events of a grouped batch when one of them is malformed", () => {
    // Refusing the batch would make Mailjet retry it for 24 h, the good reports never recorded.
    const reports = mailjetDelivery.parseReports([
      event({ event: "spam" }),
      event({ event: "sent", CustomID: "x".repeat(300) }),
      { nothing: true },
      event({ event: "blocked" }),
    ])
    expect(reports?.map((report) => report.outcome)).toEqual(["spam", "blocked"])
  })

  it("refuses a body that is not a Mailjet event", () => {
    for (const body of [null, "sent", 42, { nothing: true }, [], { event: "" }]) {
      expect(mailjetDelivery.parseReports(body), JSON.stringify(body)).toBeNull()
    }
  })
})
