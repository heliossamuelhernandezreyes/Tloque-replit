import type { RequestHandler } from "express"
import { ACCOUNT_HEADER, CLIENT_CONTEXT_HEADER, CLIENT_CONTEXT_VERSION, accountContextError } from "../shared/account-context"

export const enforceAccountContext: RequestHandler = (req, res, next) => {
  // Public immutable asset routes may deliberately override this default.
  res.setHeader("Cache-Control", "private, no-store")
  if (req.originalUrl.split("?")[0] === "/api/auth/me"
      && req.get(CLIENT_CONTEXT_HEADER) !== CLIENT_CONTEXT_VERSION) {
    return res.status(426).json({ code: "CLIENT_UPDATE_REQUIRED", message: "Hay una actualización de privacidad. Recarga Tloque para continuar." })
  }
  const actual = req.isAuthenticated() ? (req.user as any).id as number : null
  const write = !["GET", "HEAD", "OPTIONS"].includes(req.method)
  const error = accountContextError(req.get(ACCOUNT_HEADER), actual, write)
  if (error) {
    res.setHeader("X-Tloque-Session", "changed")
    return res.status(error === "ACCOUNT_CHANGED" ? 409 : 428).json({
      code: error, message: "La sesión cambió. Recarga antes de continuar.",
    })
  }
  next()
}
