export function purchaseState(order: { status: string; tokenId?: number | null } | undefined): "pending" | "confirmed" | "refunded" | "failed" {
  if (!order || order.status === "pending" || order.status === "processing") return "pending"
  if (order.status === "refunded" || order.status === "disputed") return "refunded"
  if (order.status === "paid" || order.status === "beta_free") return order.tokenId ? "confirmed" : "pending"
  return "failed"
}
