/** Published USD rates per million tokens, checked 2026-10-20.
 * Range covers off-peak and peak pricing; it is not an account invoice.
 */
export function estimateCost(model: string, usage: Record<string, any> | null) {
  const rates =
    model === "deepseek-flash"
      ? [0.003, 0.15, 0.6]
      : model === "deepseek-v4-pro"
        ? [0.022, 0.66, 1.98]
        : null;
  if (
    !rates ||
    !usage ||
    !Number.isFinite(usage.prompt_tokens) ||
    !Number.isFinite(usage.completion_tokens)
  )
    return null;
  const hit =
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const miss = usage.prompt_cache_miss_tokens ?? usage.prompt_tokens - hit;
  if (
    ![hit, miss, usage.completion_tokens].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  )
    return null;
  const minUsd =
    (hit * rates[0] + miss * rates[1] + usage.completion_tokens * rates[2]) /
    1e6;
  return {
    currency: "USD",
    minUsd,
    maxUsd: minUsd * 2,
    pricingDate: "2026-10-20",
    source: "https://api-docs.deepseek.com/quick_start/pricing",
    note: "按公开峰谷价格估算区间，实际扣费以平台账单为准",
  };
}
