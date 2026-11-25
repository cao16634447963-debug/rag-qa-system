/**
 * API 请求公共模块：登录态由 HttpOnly Cookie 承载（浏览器自动携带）
 * 收到 401 自动刷新回登录页；/api/auth/* 自身的 401（如密码错误）不触发刷新，避免死循环
 */

// 清理旧版本遗留在 localStorage 的 token（已改用 Cookie，此字段不再使用）
localStorage.removeItem('rag-qa-token');

export const apiFetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const res = await fetch(input, { credentials: 'same-origin', ...init, headers: { ...(init?.headers ?? {}) } });
    if (res.status === 401 && !input.startsWith('/api/auth/')) {
        window.location.reload(); // 回到登录页
    }
    return res;
};

/** 退出登录：清除 Cookie 后回到登录页 */
export const logout = async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
};
