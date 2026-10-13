/**
 * API 请求公共模块：统一携带访问令牌（.env 设置 API_TOKEN 后启用）
 * 浏览器控制台执行 localStorage.setItem('rag-api-token', '<令牌>') 即可配置
 */

const TOKEN_KEY = 'rag-api-token';

export const apiHeaders = (): Record<string, string> => {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { 'x-api-token': token } : {};
};

export const apiFetch = (input: string, init?: RequestInit): Promise<Response> =>
    fetch(input, { ...init, headers: { ...apiHeaders(), ...(init?.headers ?? {}) } });
