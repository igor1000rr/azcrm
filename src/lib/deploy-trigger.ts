// Re-trigger deploy на актуальный main HEAD после успешного rerun
// предыдущего деплоя (который сделал rsync со старого коммита и
// частично откатил последующие правки inbox/clients).
//
// Этот файл не используется в runtime, только для пробуждения CI.
export const DEPLOY_TRIGGER_AT = '2026-04-28T21:25:00Z';
