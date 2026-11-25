import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';

/**
 * 问答历史会话 API（数据按 userId 隔离）
 * GET    /api/chat/sessions?limit=&offset=   会话列表（按最近更新排序，分页）
 * POST   /api/chat/sessions            新建会话，返回 id（客户端发送首条消息前调用）
 * GET    /api/chat/sessions/:id/messages   会话消息（按时间升序）
 * PATCH  /api/chat/sessions/:id        重命名会话
 * DELETE /api/chat/sessions/:id        删除会话（消息级联删除）
 */

const router = Router();
router.use(requireAuth);

const PAGE_SIZE = 20;

router.get('/', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const limit = Math.min(Math.max(Number(req.query.limit) || PAGE_SIZE, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await query(
        `SELECT id, title, updated_at AS "updatedAt" FROM chat_sessions
         WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit + 1, offset],
    );
    const hasMore = result.rows.length > limit;
    res.json({ sessions: result.rows.slice(0, limit), hasMore });
});

router.post('/', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await query(
        `INSERT INTO chat_sessions (user_id) VALUES ($1)
         RETURNING id, title, updated_at AS "updatedAt"`,
        [userId],
    );
    res.json({ session: result.rows[0] });
});

/** 校验会话归属当前用户，返回是否存在 */
const ownsSession = async (userId: string | undefined, id: string): Promise<boolean> => {
    const result = await query('SELECT 1 FROM chat_sessions WHERE id = $1 AND user_id = $2', [id, userId]);
    return (result.rowCount ?? 0) > 0;
};

router.get('/:id/messages', async (req, res) => {
    const { userId } = req as AuthedRequest;
    if (!(await ownsSession(userId, req.params.id))) {
        res.status(404).json({ error: '会话不存在' });
        return;
    }
    const result = await query(
        `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [req.params.id],
    );
    res.json({ messages: result.rows });
});

router.patch('/:id', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 60) : '';
    if (!title) {
        res.status(400).json({ error: '标题不能为空' });
        return;
    }
    const result = await query(
        `UPDATE chat_sessions SET title = $1 WHERE id = $2 AND user_id = $3
         RETURNING id, title, updated_at AS "updatedAt"`,
        [title, req.params.id, userId],
    );
    if (!result.rows[0]) {
        res.status(404).json({ error: '会话不存在' });
        return;
    }
    res.json({ session: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await query(
        'DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2',
        [req.params.id, userId],
    );
    if (!result.rowCount) {
        res.status(404).json({ error: '会话不存在' });
        return;
    }
    res.json({ ok: true, id: req.params.id });
});

export default router;
