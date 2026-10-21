import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  MessageSquare,
  Library,
  Settings,
  Sparkles,
  Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setAppLanguage, type AppLanguage } from "@/lib/i18n";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const recentChats = [
  { id: "1", titleKey: "Brand strategy for launch" },
  { id: "2", titleKey: "Travel itinerary draft" },
  { id: "3", titleKey: "Q3 marketing review" },
  { id: "4", titleKey: "Code review notes" },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const [activeId, setActiveId] = useState("1");

  const toggleLang = () => {
    const next: AppLanguage = i18n.language === "ar" ? "en" : "ar";
    setAppLanguage(next);
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 76 : 288 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="relative z-20 flex h-screen shrink-0 flex-col glass-strong"
    >
      <div className="flex items-center justify-between gap-2 p-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <img
            src="/brand/pwa-192.png"
            alt="ChatHSM"
            className="h-9 w-9 shrink-0 rounded-full object-cover shadow-lg"
          />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                className="overflow-hidden"
              >
                <div className="text-sm font-semibold leading-tight">
                  {t("app.name")}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {t("app.tagline")}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      <div className="px-3">
        <Button
          className="w-full justify-start gap-2 rounded-xl border border-glass-border bg-glass text-foreground hover:bg-white/10"
          variant="ghost"
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{t("sidebar.newChat")}</span>}
        </Button>
      </div>

      <div className="mt-3 px-3">
        <div className={cn(
          "flex items-center gap-2 rounded-xl border border-glass-border bg-glass px-3 py-2 text-sm text-muted-foreground",
          collapsed && "justify-center px-0",
        )}>
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <input
              type="text"
              placeholder={t("sidebar.search")}
              className="w-full bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          )}
        </div>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-2">
        {!collapsed && (
          <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("sidebar.recent")}
          </div>
        )}
        <ul className="space-y-1">
          {recentChats.map((chat) => (
            <li key={chat.id}>
              <button
                onClick={() => setActiveId(chat.id)}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  activeId === chat.id
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{chat.titleKey}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-glass-border p-2">
        <SidebarItem icon={Library} label={t("sidebar.library")} collapsed={collapsed} />
        <SidebarItem
          icon={Languages}
          label={i18n.language === "ar" ? "English" : "العربية"}
          collapsed={collapsed}
          onClick={toggleLang}
        />
        <SidebarItem icon={Settings} label={t("sidebar.settings")} collapsed={collapsed} />
      </div>
    </motion.aside>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  collapsed,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
