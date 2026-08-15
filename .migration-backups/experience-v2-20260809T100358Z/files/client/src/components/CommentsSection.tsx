import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { MessageCircle, Send, EyeOff, Eye, Lock, Loader2, ShieldOff, ShieldCheck } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useSettings } from "@/context/SettingsContext"
import UserAvatar from "@/components/UserAvatar"

interface Props {
  bookId:       number
  chapterIndex: number        // capítulo al que pertenecen estos comentarios
  locked:       boolean       // el lector ya avanzó más allá de este capítulo
  accentColor:  string
  accentGlow:   string
  textColor:    string
}

interface CommentItem {
  id:           number
  chapterIndex: number
  userId:       number
  userName:     string
  userAvatar:   string
  content:      string
  status:       string
  createdAt:    string
}

function timeAgo(iso: string, t: (k: string) => string): string {
  const then = new Date(iso).getTime()
  const secs = Math.floor((Date.now() - then) / 1000)
  if (secs < 60)    return t("timeNow")
  const mins = Math.floor(secs / 60)
  if (mins < 60)    return t("timeMin").replace("{n}", String(mins))
  const hours = Math.floor(mins / 60)
  if (hours < 24)   return t("timeHr").replace("{n}", String(hours))
  const days = Math.floor(hours / 24)
  if (days < 30)    return t("timeDay").replace("{n}", String(days))
  return new Date(iso).toLocaleDateString()
}

export default function CommentsSection({
  bookId, chapterIndex, locked, accentColor, accentGlow, textColor,
}: Props) {
  const { user } = useAuth()
  const { t } = useSettings()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")

  const queryKey = ["/api/books/:id/comments", bookId, chapterIndex]

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/books/${bookId}/comments?chapter=${chapterIndex}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error("Error")
      return res.json() as Promise<{
        commentsEnabled: boolean
        canModerate:     boolean
        comments:        CommentItem[]
      }>
    },
  })

  const post = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/books/${bookId}/comments`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ chapterIndex, content }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.message || t("commentPostErr"))
      }
      return res.json()
    },
    onSuccess: () => {
      setDraft("")
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const moderate = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "visible" | "hidden" }) => {
      const res = await fetch(`/api/comments/${id}/status`, {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error("Error moderando")
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(`/api/books/${bookId}/comments-enabled`, {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error("Error")
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const enabled     = data?.commentsEnabled !== false
  const canModerate = !!data?.canModerate
  const list        = data?.comments || []

  return (
    <div className="mt-12 pt-8" style={{ borderTop: `1px solid ${textColor}15` }}>
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4" style={{ color: accentColor }} />
          <span className="text-sm font-sans font-semibold" style={{ color: textColor }}>
            {t("commentsTitle")}
          </span>
          {list.length > 0 && (
            <span className="text-xs font-sans" style={{ color: textColor + "60" }}>
              · {list.length}
            </span>
          )}
        </div>

        {/* Interruptor del autor/admin */}
        {canModerate && (
          <button
            onClick={() => toggleEnabled.mutate(!enabled)}
            disabled={toggleEnabled.isPending}
            className="flex items-center gap-1.5 text-[11px] font-sans px-2.5 py-1.5 rounded-lg transition-colors"
            style={{
              background: enabled ? `${accentGlow}18` : "rgba(120,120,130,0.12)",
              color:      enabled ? accentColor : textColor + "70",
              border:     `1px solid ${enabled ? accentColor + "40" : textColor + "20"}`,
            }}
          >
            {enabled
              ? <><ShieldCheck className="w-3 h-3" /> {t("commentsOn")}</>
              : <><ShieldOff className="w-3 h-3" /> {t("commentsOff")}</>}
          </button>
        )}
      </div>

      {/* Comentarios desactivados */}
      {!enabled ? (
        <p className="text-xs font-sans text-center py-6" style={{ color: textColor + "50" }}>
          {canModerate
            ? t("commentsOffByYou")
            : t("commentsOffByAuthor")}
        </p>
      ) : (
        <>
          {/* Caja para escribir */}
          {user ? (
            locked ? (
              <div className="flex items-center gap-2 rounded-2xl px-4 py-3 mb-6"
                style={{ background: textColor + "08", border: `1px solid ${textColor}12` }}>
                <Lock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: textColor + "55" }} />
                <p className="text-[11px] font-sans leading-snug" style={{ color: textColor + "60" }}>
                  {t("commentsLocked")}
                </p>
              </div>
            ) : (
              <div className="mb-6">
                <div className="rounded-2xl overflow-hidden"
                  style={{ background: textColor + "08", border: `1px solid ${textColor}15` }}>
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value.slice(0, 2000))}
                    placeholder={t("commentPh")}
                    rows={3}
                    className="w-full bg-transparent px-4 py-3 text-sm font-sans resize-none outline-none"
                    style={{ color: textColor }}
                  />
                  <div className="flex items-center justify-between px-3 py-2"
                    style={{ borderTop: `1px solid ${textColor}10` }}>
                    <span className="text-[10px] font-sans" style={{ color: textColor + "40" }}>
                      {draft.length}/2000
                    </span>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => draft.trim() && post.mutate(draft.trim())}
                      disabled={!draft.trim() || post.isPending}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-sans font-semibold disabled:opacity-40"
                      style={{
                        background: `linear-gradient(135deg, ${accentGlow}cc, ${accentColor})`,
                        color:      "rgba(0,0,0,0.85)",
                      }}
                    >
                      {post.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Send className="w-3 h-3" />}
                      {t("commentSend")}
                    </motion.button>
                  </div>
                </div>
                {post.isError && (
                  <p className="text-[11px] font-sans mt-2 px-1" style={{ color: "#e8a0a0" }}>
                    {(post.error as Error)?.message || t("commentPostErr")}
                  </p>
                )}
              </div>
            )
          ) : (
            <p className="text-xs font-sans text-center py-4 mb-2" style={{ color: textColor + "50" }}>
              {t("commentLoginFirst")}
            </p>
          )}

          {/* Lista de comentarios */}
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: textColor + "40" }} />
            </div>
          ) : list.length === 0 ? (
            <p className="text-xs font-sans text-center py-6" style={{ color: textColor + "45" }}>
              {t("commentsEmpty")}
            </p>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {list.map(c => {
                  const hidden = c.status === "hidden"
                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: hidden ? 0.45 : 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex gap-3"
                    >
                      {/* Avatar */}
                      <div className="flex-shrink-0 mt-0.5">
                        <UserAvatar
                          src={c.userAvatar || null}
                          name={c.userName}
                          size={30}
                          accentColor={accentColor}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-sans font-semibold" style={{ color: textColor }}>
                            {c.userName || t("readerFallback")}
                          </span>
                          <span className="text-[10px] font-sans" style={{ color: textColor + "45" }}>
                            {timeAgo(c.createdAt, t)}
                          </span>
                          {hidden && (
                            <span className="text-[9px] font-sans px-1.5 py-0.5 rounded-full"
                              style={{ background: "rgba(255,150,80,0.15)", color: "rgba(255,170,100,0.9)" }}>
                              {t("hiddenBadge")}
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] font-sans leading-relaxed mt-0.5 whitespace-pre-wrap break-words"
                          style={{ color: textColor + "d0" }}>
                          {c.content}
                        </p>

                        {/* Moderación */}
                        {canModerate && (
                          <button
                            onClick={() => moderate.mutate({ id: c.id, status: hidden ? "visible" : "hidden" })}
                            disabled={moderate.isPending}
                            className="flex items-center gap-1 text-[10px] font-sans mt-1.5 opacity-70 hover:opacity-100"
                            style={{ color: hidden ? "rgba(150,230,170,0.9)" : textColor + "60" }}
                          >
                            {hidden
                              ? <><Eye className="w-3 h-3" /> {t("restoreWord")}</>
                              : <><EyeOff className="w-3 h-3" /> {t("hideWord")}</>}
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  )
}
