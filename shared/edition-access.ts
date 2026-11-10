/** A moderation/rights hold applies to every delivery channel and edition. */
export function isEditionRestricted(book: { rightsHold?: boolean; status?: string } | null | undefined): boolean {
  return !book || book.rightsHold === true || book.status === "review"
}

export function withoutPremiumArt<T extends Record<string, any>>(book: T, allowed: boolean): T {
  return allowed ? book : { ...book, premiumCoverUrl: "", premiumBackUrl: "" }
}
