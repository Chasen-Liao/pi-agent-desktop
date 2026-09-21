export function formatDuration(seconds: number, locale: "zh" | "en" = "zh"): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return locale === "zh" ? "即将" : "now";
  }

  const days = Math.floor(seconds / 86400);
  const remainderAfterDays = seconds % 86400;
  const hours = Math.floor(remainderAfterDays / 3600);
  const remainderAfterHours = remainderAfterDays % 3600;
  const minutes = Math.floor(remainderAfterHours / 60);

  if (days > 0) {
    if (hours > 0) {
      return locale === "zh" ? `${days}天${hours}小时` : `${days}d ${hours}h`;
    }
    return locale === "zh" ? `${days}天` : `${days}d`;
  }

  if (hours > 0) {
    if (minutes > 0) {
      return locale === "zh" ? `${hours}小时${minutes}分` : `${hours}h ${minutes}m`;
    }
    return locale === "zh" ? `${hours}小时` : `${hours}h`;
  }

  if (minutes > 0) {
    return locale === "zh" ? `${minutes}分钟` : `${minutes}m`;
  }

  const sec = Math.floor(seconds);
  return locale === "zh" ? `${sec}秒` : `${sec}s`;
}
