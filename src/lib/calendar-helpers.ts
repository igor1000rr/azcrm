// Вспомогательные pure-функции для серверной страницы календаря.
// Без внешних зависимостей — это важно для unit-тестирования.

/**
 * Статус подачи внеска для события календаря по привязанному лиду:
 *   - null  → событие без привязки (внутр. встреча)
 *   - true  → лид есть, submittedAt проставлен
 *   - false → лид есть, submittedAt = null → требует подсветки «внесок не подан»
 *
 * Используется в calendar/page.tsx при маппинге events[].lead → EventLite.submitted.
 * Anna 30.04.2026 «волшебная штучка».
 */
export function computeSubmissionStatus(
  lead: { submittedAt: Date | null } | null | undefined,
): boolean | null {
  if (!lead) return null;
  return lead.submittedAt !== null;
}
