import { useRef, useEffect, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ArrowUp, Paperclip, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSubmit, disabled }: ChatInputProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-3xl"
    >
      <div className="glass-strong rounded-3xl p-2 shadow-[var(--shadow-elevated)] transition-all focus-within:ring-2 focus-within:ring-primary/40">
        <div className="flex items-end gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-2xl text-muted-foreground hover:bg-white/10 hover:text-foreground"
            type="button"
          >
            <Paperclip className="h-4.5 w-4.5" />
          </Button>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t("chat.placeholder")}
            rows={1}
            className="flex-1 resize-none bg-transparent px-1 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-2xl text-muted-foreground hover:bg-white/10 hover:text-foreground"
            type="button"
          >
            <Mic className="h-4.5 w-4.5" />
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={disabled || !value.trim()}
            size="icon"
            className={cn(
              "h-10 w-10 shrink-0 rounded-2xl text-primary-foreground shadow-lg transition-all",
              "disabled:opacity-40",
            )}
            style={{ background: "var(--gradient-primary)" }}
          >
            <ArrowUp className="h-4.5 w-4.5" strokeWidth={2.5} />
          </Button>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        ChatHSM can make mistakes. Verify important information.
      </p>
    </motion.div>
  );
}
