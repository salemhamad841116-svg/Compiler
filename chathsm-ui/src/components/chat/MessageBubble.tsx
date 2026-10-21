import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface MessageBubbleProps {
  message: ChatMessage;
  index: number;
}

export function MessageBubble({ message, index }: MessageBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.15), ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex w-full gap-4", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <div
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full shadow-md",
          isUser ? "bg-secondary" : "",
        )}
        style={!isUser ? { background: "var(--gradient-primary)" } : undefined}
      >
        {isUser ? (
          <User className="h-5 w-5 text-foreground" />
        ) : (
          <Sparkles className="h-5 w-5 text-primary-foreground" />
        )}
      </div>
      <div className={cn("flex max-w-[80%] flex-col gap-2", isUser ? "items-end" : "items-start")}>
        <div className="text-sm font-medium text-muted-foreground">
          {isUser ? t("chat.you") : t("chat.assistant")}
        </div>
        <div
          className={cn(
            "rounded-2xl px-5 py-4 text-base leading-relaxed whitespace-pre-wrap",
            isUser
              ? "bg-primary text-primary-foreground shadow-lg"
              : "glass-panel text-foreground",
          )}
        >
          {message.content}
        </div>
      </div>
    </motion.div>
  );
}
