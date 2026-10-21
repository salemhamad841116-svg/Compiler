import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ChatInput } from "./ChatInput";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { AuroraBackground } from "./AuroraBackground";

const suggestionKeys = [
  "chat.suggestions.one",
  "chat.suggestions.two",
  "chat.suggestions.three",
  "chat.suggestions.four",
] as const;

export function ChatWorkspace() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const send = (text?: string) => {
    const content = (text ?? input).trim();
    if (!content) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setPending(true);
    window.setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "This is a demo response. Connect your AI provider to stream real answers here.",
        },
      ]);
      setPending(false);
    }, 900);
  };

  const empty = messages.length === 0;

  return (
    <div className="relative flex h-screen w-full overflow-hidden text-foreground">
      <AuroraBackground />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
            <span>Online</span>
          </div>
        </header>

        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 sm:px-8">
            <div className="mx-auto w-full max-w-3xl py-6">
              <AnimatePresence mode="wait">
                {empty ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="flex min-h-[60vh] flex-col items-center justify-center text-center"
                  >
                    <div
                      className="mb-6 grid h-16 w-16 place-items-center rounded-3xl shadow-[var(--shadow-elevated)]"
                      style={{ background: "var(--gradient-primary)" }}
                    >
                      <Sparkles className="h-7 w-7 text-primary-foreground" strokeWidth={2.2} />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                      <span className="gradient-text">{t("chat.greeting")}</span>
                    </h1>
                    <p className="mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
                      {t("chat.subtitle")}
                    </p>
                    <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                      {suggestionKeys.map((key, i) => (
                        <motion.button
                          key={key}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.15 + i * 0.06, duration: 0.4 }}
                          whileHover={{ y: -2 }}
                          onClick={() => send(t(key))}
                          className="glass-panel rounded-2xl px-4 py-3.5 text-start text-sm text-foreground/90 transition-colors hover:bg-white/10"
                        >
                          {t(key)}
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="thread"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col gap-6 pb-4"
                  >
                    {messages.map((m, i) => (
                      <MessageBubble key={m.id} message={m} index={i} />
                    ))}
                    {pending && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                      >
                        <span className="inline-flex gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                        </span>
                        {t("chat.thinking")}
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="px-4 pb-6 pt-2 sm:px-8">
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={() => send()}
              disabled={pending}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
