import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { rateLimit } from './middleware.js';

/**
 * 分类管理 API（数据按 userId 隔离）
 * GET    /api/categories      分类列表（含书签计数）
 * POST   /api/categories      新建分类 { name, color? }
 * PUT    /api/categories/:id  改名/改色
 * DELETE /api/categories/:id  删除分类（其下书签 categoryId 置空，不删书签）
 */

const router = Router();
router.use(requireAuth, rateLimit(30, 60_000));

const upsertSchema = z.object({
    name: z.string().trim().min(1, '分类名不能为空').max(32, '分类名最多 32 个字符'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #RRGGBB 格式').nullish(),
});

/** 校验分类归属当前用户，返回是否存在 */
const ownsCategory = async (userId: string, id: string): Promise<boolean> => {
    const result = await query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [id, userId]);
    return (result.rowCount ?? 0) > 0;
};

router.get('/', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await query(
        `SELECT c.id, c.name, c.color, c.created_at AS "createdAt",
                (SELECT COUNT(*)::int FROM bookmarks b WHERE b.category_id = c.id) AS count
         FROM categories c WHERE c.user_id = $1 ORDER BY c.created_at`,
        [userId],
    );
    res.json({ categories: result.rows });
});

router.post('/', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
        return;
    }
    const { name, color } = parsed.data;

    const result = await query(
        'INSERT INTO categories (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color, created_at AS "createdAt"',
        [userId, name, color ?? null],
    );
    res.json({ category: result.rows[0] });
});

router.put('/:id', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
        return;
    }

    if (!(await ownsCategory(userId!, req.params.id))) {
        res.status(404).json({ error: '分类不存在' });
        return;
    }
    const { name, color } = parsed.data;
    const result = await query(
        'UPDATE categories SET name = $1, color = $2 WHERE id = $3 AND user_id = $4 RETURNING id, name, color, created_at AS "createdAt"',
        [name, color ?? null, req.params.id, userId],
    );
    res.json({ category: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await query(
        'DELETE FROM categories WHERE id = $1 AND user_id = $2',
        [req.params.id, userId],
    );
    if (!result.rowCount) {
        res.status(404).json({ error: '分类不存在' });
        return;
    }
    res.json({ ok: true, id: req.params.id });
});

export default router;
