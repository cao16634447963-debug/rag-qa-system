import { Router } from 'express';
import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, signToken, type AuthedRequest } from '../auth/middleware.js';
import { rateLimit } from './middleware.js';

/**
 * 用户认证 API（HttpOnly Cookie 承载登录态）
 * POST /api/auth/register  注册（用户名 2-32 字符，密码 ≥8 位且含字母和数字）
 * POST /api/auth/login     登录，写入 Cookie（连续失败 5 次锁定 5 分钟）
 * POST /api/auth/logout    登出，清除 Cookie
 * GET  /api/auth/me        当前用户信息
 */

const router = Router();
router.use(rateLimit(10, 60_000));

const COOKIE_NAME = 'token';
const COOKIE_MAX_AGE = 7 * 24 * 3600 * 1000; // 与 JWT 有效期一致

/** 登录态写入 HttpOnly Cookie；https 部署时设 COOKIE_SECURE=true 开启 Secure */
const sendAuthCookie = (res: Response, token: string): void => {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
    });
};

const credentialsSchema = z.object({
    username: z.string().trim().min(2, '用户名至少 2 个字符').max(32, '用户名最多 32 个字符'),
    password: z
        .string()
        .min(8, '密码至少 8 位')
        .max(64, '密码最多 64 位')
        .regex(/[A-Za-z]/, '密码需包含字母')
        .regex(/[0-9]/, '密码需包含数字'),
});

// 登录失败锁定：同一用户名连续失败 MAX_FAILURES 次后锁定 LOCK_MS，防暴力破解
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;
const failures = new Map<string, { count: number; lockedUntil: number }>();

const checkLock = (username: string): number => {
    const rec = failures.get(username);
    if (!rec) return 0;
    if (rec.lockedUntil > Date.now()) return rec.lockedUntil - Date.now();
    if (rec.lockedUntil > 0) failures.delete(username);
    return 0;
};

const recordFailure = (username: string): void => {
    const rec = failures.get(username) ?? { count: 0, lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= MAX_FAILURES) {
        rec.lockedUntil = Date.now() + LOCK_MS;
        rec.count = 0;
    }
    failures.set(username, rec);
};

const clearFailures = (username: string): void => {
    failures.delete(username);
};

const toTokenPayload = (res: Response, user: { id: string; username: string }) => {
    sendAuthCookie(res, signToken(user.id, user.username));
    return { user: { id: user.id, username: user.username } };
};

router.post('/register', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
        return;
    }
    const { username, password } = parsed.data;

    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rowCount && existing.rowCount > 0) {
        res.status(409).json({ error: '用户名已存在' });
        return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username, passwordHash],
    );
    res.json(toTokenPayload(res, result.rows[0]));
});

router.post('/login', async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: '用户名或密码格式不正确' });
        return;
    }
    const { username, password } = parsed.data;

    const lockRemaining = checkLock(username);
    if (lockRemaining > 0) {
        res.status(429).json({
            error: `失败次数过多，该用户名已锁定，请 ${Math.ceil(lockRemaining / 60_000)} 分钟后重试`,
        });
        return;
    }

    const result = await query(
        'SELECT id, username, password_hash FROM users WHERE username = $1',
        [username],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        recordFailure(username);
        res.status(401).json({ error: '用户名或密码错误' });
        return;
    }

    clearFailures(username);
    res.json(toTokenPayload(res, user));
});

router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await query(
        'SELECT id, username, created_at FROM users WHERE id = $1',
        [userId],
    );
    if (!result.rows[0]) {
        res.status(404).json({ error: '用户不存在' });
        return;
    }
    const { id, username, created_at } = result.rows[0];
    res.json({ id, username, createdAt: created_at });
});

export default router;
