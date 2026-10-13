import type { NextFunction, Request, Response } from 'express';

/**
 * API 中间件：可选鉴权 + 按 IP 的滑动窗口限流
 */

/**
 * 可选鉴权：.env 设置了 API_TOKEN 时启用，要求请求头 x-api-token 匹配；
 * 未设置则不启用（本地开发零配置）
 */
export const auth = (req: Request, res: Response, next: NextFunction): void => {
    const token = process.env.API_TOKEN;
    if (!token) {
        next();
        return;
    }
    if (req.header('x-api-token') === token) {
        next();
        return;
    }
    res.status(401).json({ error: '未授权：请通过 x-api-token 请求头携带访问令牌' });
};

type Bucket = number[];

/**
 * 按 IP 滑动窗口限流
 * @param max 窗口内最大请求数
 * @param windowMs 窗口时长（毫秒）
 */
export const rateLimit = (max: number, windowMs: number) => {
    const buckets = new Map<string, Bucket>();

    // 定期清理过期桶，避免内存泄漏
    setInterval(() => {
        const now = Date.now();
        for (const [ip, hits] of buckets) {
            const alive = hits.filter((t) => now - t < windowMs);
            if (alive.length === 0) buckets.delete(ip);
            else buckets.set(ip, alive);
        }
    }, windowMs).unref();

    return (req: Request, res: Response, next: NextFunction): void => {
        const ip = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const hits = (buckets.get(ip) ?? []).filter((t) => now - t < windowMs);

        if (hits.length >= max) {
            res.status(429).json({ error: '请求过于频繁，请稍后再试' });
            return;
        }

        hits.push(now);
        buckets.set(ip, hits);
        next();
    };
};
