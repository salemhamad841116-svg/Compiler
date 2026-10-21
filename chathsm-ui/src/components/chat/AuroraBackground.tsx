import { motion } from "framer-motion";

export function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <div className="absolute inset-0 aurora-bg opacity-90" />
      <motion.div
        aria-hidden
        className="absolute -top-32 start-1/4 h-[36rem] w-[36rem] rounded-full blur-3xl"
        style={{ background: "var(--gradient-primary)", opacity: 0.25 }}
        animate={{ x: [0, 60, -40, 0], y: [0, 40, -20, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute bottom-0 end-0 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ background: "oklch(0.65 0.2 330 / 35%)" }}
        animate={{ x: [0, -50, 30, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
    </div>
  );
}
