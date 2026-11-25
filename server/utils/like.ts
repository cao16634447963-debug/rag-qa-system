/** 转义 LIKE/ILIKE 通配符，避免搜索词中的 % _ 被当作模式 */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);
