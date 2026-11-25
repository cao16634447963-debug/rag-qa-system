import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { rateLimit } from './middleware.js';

/**
 * 书签管理 API（数据按 userId 隔离）
 * GET    /api/bookmarks?q=&categoryId=   列表；q 对 title/url/description 做 ILIKE 包含匹配
 * POST   /api/bookmarks                  新增 { title, url, description?, categoryId? }
 * PUT    /api/bookmarks/:id              更新
 * DELETE /api/bookmarks/:id              删除
 */

const router = Router();
router.use(requireAuth, rateLimit(60, 60_000));

const bookmarkSchema = z.object({
    title: z.string().trim().min(1, '标题不能为空').max(120, '标题最多 120 个字符'),
    url: z.string().trim().url('URL 格式不正确').max(2048),
    description: z.string().trim().max(500, '备注最多 500 个字符').nullish(),
    categoryId: z.string().uuid('分类 ID 不合法').nullish(),
});

/** 校验分类归属当前用户，返回是否存在 */
const ownsCategory = async (userId: string, id: string): Promise<boolean> => {
    const result = await query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [id, userId]);
    return (result.rowCount ?? 0) > 0;
};

import { escapeLike } from '../utils/like.js';

router.get('/', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : '';

    const conditions = ['b.user_id = $1'];
    const params: unknown[] = [userId];

    if (q) {
        params.push(`%${escapeLike(q)}%`);
        const like = `$${params.length}`;
        conditions.push(`(b.title ILIKE ${like} OR b.url ILIKE ${like} OR b.description ILIKE ${like})`);
    }
    if (categoryId) {
        params.push(categoryId);
        conditions.push(`b.category_id = $${params.length}`);
    }

    const result = await query(
        `SELECT b.id, b.title, b.url, b.description, b.category_id AS "categoryId",
                c.name AS "categoryName", c.color AS "categoryColor", b.created_at AS "createdAt"
         FROM bookmarks b
         LEFT JOIN categories c ON c.id = b.category_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY b.created_at DESC`,
        params,
    );
    res.json({ bookmarks: result.rows });
});

router.post('/', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const parsed = bookmarkSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
        return;
    }
    const { title, url, description, categoryId } = parsed.data;

    if (categoryId && !(await ownsCategory(userId!, categoryId))) {
        res.status(400).json({ error: '分类不存在' });
        return;
    }

    const result = await query(
        `INSERT INTO bookmarks (user_id, title, url, description, category_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, url, description, category_id AS "categoryId", created_at AS "createdAt"`,
        [userId, title, url, description ?? null, categoryId ?? null],
    );
    res.json({ bookmark: result.rows[0] });
});

router.put('/:id', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const parsed = bookmarkSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
        return;
    }
    const { title, url, description, categoryId } = parsed.data;

    if (categoryId && !(await ownsCategory(userId!, categoryId))) {
        res.status(400).json({ error: '分类不存在' });
        return;
    }

    const result = await query(
        `UPDATE bookmarks SET title = $1, url = $2, description = $3, category_id = $4
         WHERE id = $5 AND user_id = $6
         RETURNING id, title, url, description, category_id AS "categoryId", created_at AS "createdAt"`,
        [title, url, description ?? null, categoryId ?? null, req.params.id, userId],
    );
    if (!result.rowCount) {
        res.status(404).json({ error: '书签不存在' });
        return;
    }
    res.json({ bookmark: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await query(
        'DELETE FROM bookmarks WHERE id = $1 AND user_id = $2',
        [req.params.id, userId],
    );
    if (!result.rowCount) {
        res.status(404).json({ error: '书签不存在' });
        return;
    }
    res.json({ ok: true, id: req.params.id });
});

export default router;
