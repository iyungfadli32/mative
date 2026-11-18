/**
 * ChannelIcon — ikon channel per platform (teks + simbol, tanpa logo pihak ketiga).
 * Platform yang didukung ditambah di Phase 2 (channel registry); di fase ini
 * hanya pemetaan dasar untuk kalender/board mendatang.
 */
const CHANNEL_ICONS: Record<string, { icon: string; label: string }> = {
  instagram: { icon: "📷", label: "Instagram" },
  tiktok: { icon: "🎵", label: "TikTok" },
  youtube: { icon: "▶️", label: "YouTube" },
  facebook: { icon: "👥", label: "Facebook" },
  linkedin: { icon: "💼", label: "LinkedIn" },
  x: { icon: "✖️", label: "X" },
  threads: { icon: "🧵", label: "Threads" },
};

export function ChannelIcon({ platform, size = "md" }: { platform: string; size?: "sm" | "md" }) {
  const entry = CHANNEL_ICONS[platform.toLowerCase()] ?? {
    icon: "🌐",
    label: platform,
  };
  return (
    <span
      role="img"
      aria-label={`Channel ${entry.label}`}
      title={entry.label}
      className={
        size === "sm"
          ? "inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--mt-canvas)] text-sm"
          : "inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--mt-canvas)] text-base"
      }
    >
      {entry.icon}
    </span>
  );
}
