import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

/**
 * 用户鉴权中间件：校验 HttpOnly Cookie 或 Authorization: Bearer <JWT>
 * 校验通过后把 userId / username 挂到请求上，供路由做数据隔离
 */

export type AuthedRequest = Request & { userId?: string; username?: string };

const secret = (): string | undefined => process.env.JWT_SECRET;

export const signToken = (userId: string, username: string): string =>
    jwt.sign({ sub: userId, username }, secret() as string, { expiresIn: '7d' });

const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!secret()) {
        res.status(500).json({ error: '服务端未配置 JWT_SECRET' });
        return;
    }

    // 优先 HttpOnly Cookie，兼容 Bearer 头（便于脚本/测试调用）
    const header = req.header('authorization') ?? '';
    const token = req.cookies?.token ?? (header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!token) {
        res.status(401).json({ error: '未登录' });
        return;
    }

    try {
        const payload = jwt.verify(token, secret() as string) as { sub?: string; username?: string };
        if (!payload.sub) throw new Error('token 缺少用户标识');
        (req as AuthedRequest).userId = payload.sub;
        (req as AuthedRequest).username = payload.username ?? '';
        next();
    } catch {
        res.status(401).json({ error: '登录已过期，请重新登录' });
    }
};

export { requireAuth };
