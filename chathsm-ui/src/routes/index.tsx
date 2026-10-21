import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ChatHSM — Premium AI workspace" },
      {
        name: "description",
        content:
          "ChatHSM is a premium AI chat workspace with a refined glassmorphism interface, collapsible sidebar, and smooth animations.",
      },
      { property: "og:title", content: "ChatHSM — Premium AI workspace" },
      {
        property: "og:description",
        content:
          "Premium AI chat workspace with glassmorphism, collapsible sidebar, and smooth animations.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const dir = i18n.language === "ar" ? "rtl" : "ltr";
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", i18n.language);
  }, [i18n.language]);

  return <ChatWorkspace />;
}
